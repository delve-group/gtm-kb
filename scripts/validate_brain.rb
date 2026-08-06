#!/usr/bin/env ruby
# frozen_string_literal: true

require "date"
require "json"
require "optparse"
require "pathname"
require "set"
require "time"
require "uri"
require "yaml"

module CompanyBrain
  Diagnostic = Struct.new(:severity, :layer, :path, :line, :code, :message, keyword_init: true) do
    def to_h
      {
        severity: severity,
        layer: layer,
        path: path,
        line: line,
        code: code,
        message: message
      }
    end
  end

  class Validator
    STATUS_VALUES = %w[draft stable deprecated].freeze
    VISIBILITY_VALUES = %w[public internal].freeze
    PUBLICATION_VALUES = %w[approved review-required prohibited].freeze
    RESERVED_FILES = %w[index.md log.md].freeze

    attr_reader :diagnostics

    def initialize(bundle, today: Date.today, okf_only: false)
      @bundle = Pathname.new(bundle).expand_path
      @repository_root = @bundle.parent
      @today = today
      @okf_only = okf_only
      @diagnostics = []
      @frontmatter_cache = {}
    end

    def run
      unless @bundle.directory?
        add(:error, :okf, @bundle.to_s, 1, "BUNDLE_NOT_FOUND", "Bundle directory does not exist.")
        return diagnostics
      end

      markdown_files.each do |file|
        case file.basename.to_s
        when "index.md"
          validate_index(file)
        when "log.md"
          validate_log(file)
        else
          validate_concept(file)
        end
      end

      validate_index_coverage unless @okf_only
      diagnostics.sort_by! { |item| [relative(item.path), item.line || 0, item.code] }
    end

    def errors
      diagnostics.select { |item| item.severity == :error }
    end

    def warnings
      diagnostics.select { |item| item.severity == :warning }
    end

    private

    def markdown_files
      @markdown_files ||= Dir.glob(@bundle.join("**", "*.md").to_s).sort.map { |path| Pathname.new(path) }
    end

    def read(file)
      File.read(file, encoding: "UTF-8")
    rescue Encoding::InvalidByteSequenceError, Encoding::UndefinedConversionError
      add(:error, :okf, file, 1, "INVALID_UTF8", "Markdown file is not valid UTF-8.")
      ""
    rescue SystemCallError => error
      add(:error, :okf, file, 1, "UNREADABLE_FILE", error.message)
      ""
    end

    def parse_frontmatter(file)
      return @frontmatter_cache[file.to_s] if @frontmatter_cache.key?(file.to_s)

      text = read(file)
      unless text.start_with?("---\n", "---\r\n")
        return @frontmatter_cache[file.to_s] = { data: nil, body: text, closing_line: nil }
      end

      lines = text.lines
      closing_index = (1...lines.length).find { |index| lines[index].strip == "---" }
      unless closing_index
        add(:error, :okf, file, 1, "UNCLOSED_FRONTMATTER", "Frontmatter is missing its closing delimiter.")
        return @frontmatter_cache[file.to_s] = { data: nil, body: text, closing_line: nil }
      end

      yaml_text = lines[1...closing_index].join
      detect_duplicate_keys(file, yaml_text)
      begin
        data = YAML.safe_load(yaml_text, permitted_classes: [Date, Time], aliases: false) || {}
        unless data.is_a?(Hash)
          add(:error, :okf, file, 2, "FRONTMATTER_NOT_MAPPING", "Frontmatter must be a YAML mapping.")
          data = {}
        end
      rescue Psych::Exception => error
        line = error.respond_to?(:line) && error.line ? error.line + 1 : 2
        add(:error, :okf, file, line, "INVALID_YAML", error.message.lines.first.to_s.strip)
        data = {}
      end

      @frontmatter_cache[file.to_s] = {
        data: data,
        body: lines[(closing_index + 1)..].to_a.join,
        closing_line: closing_index + 1
      }
    end

    def detect_duplicate_keys(file, yaml_text)
      document = Psych.parse(yaml_text)
      walk_yaml_node(file, document&.root)
    rescue Psych::Exception
      nil
    end

    def walk_yaml_node(file, node)
      return unless node

      if node.is_a?(Psych::Nodes::Mapping)
        seen = {}
        node.children.each_slice(2) do |key_node, value_node|
          if key_node.is_a?(Psych::Nodes::Scalar)
            key = key_node.value
            if seen.key?(key)
              add(:error, :okf, file, key_node.start_line + 2, "DUPLICATE_YAML_KEY", "Duplicate YAML key `#{key}`.")
            end
            seen[key] = true
          end
          walk_yaml_node(file, value_node)
        end
      elsif node.respond_to?(:children)
        Array(node.children).each { |child| walk_yaml_node(file, child) }
      end
    end

    def validate_index(file)
      parsed = parse_frontmatter(file)
      if file == @bundle.join("index.md")
        data = parsed[:data]
        unless data
          add(:error, :okf, file, 1, "ROOT_INDEX_VERSION_MISSING", "Root index must declare `okf_version: \"0.2\"`.")
          return
        end
        extra = data.keys.map(&:to_s) - ["okf_version"]
        add(:error, :okf, file, 2, "ROOT_INDEX_EXTRA_FRONTMATTER", "Root index frontmatter may contain only `okf_version`.") unless extra.empty?
        unless data["okf_version"].to_s == "0.2"
          add(:error, :okf, file, 2, "ROOT_INDEX_VERSION_INVALID", "Root index must declare OKF version 0.2.")
        end
      elsif parsed[:data]
        add(:error, :okf, file, 1, "INDEX_FRONTMATTER_FORBIDDEN", "Only the bundle-root index may contain frontmatter.")
      end

      validate_markdown_links(file, parsed[:body])
    end

    def validate_log(file)
      parsed = parse_frontmatter(file)
      add(:error, :okf, file, 1, "LOG_FRONTMATTER_FORBIDDEN", "Log files must not contain frontmatter.") if parsed[:data]

      dates = []
      read(file).lines.each_with_index do |line, index|
        next unless line.start_with?("## ")

        value = line.delete_prefix("## ").strip
        unless iso_date(value)
          add(:error, :okf, file, index + 1, "LOG_DATE_INVALID", "Log heading must be an ISO date (`YYYY-MM-DD`).")
          next
        end
        dates << [Date.iso8601(value), index + 1]
      end
      dates.each_cons(2) do |left, right|
        if left.first < right.first
          add(:error, :okf, file, right.last, "LOG_ORDER_INVALID", "Log date headings must be newest first.")
        end
      end
      validate_markdown_links(file, parsed[:body])
    end

    def validate_concept(file)
      parsed = parse_frontmatter(file)
      data = parsed[:data]
      unless data
        add(:error, :okf, file, 1, "FRONTMATTER_REQUIRED", "Concept documents require YAML frontmatter.")
        validate_markdown_links(file, parsed[:body])
        return
      end

      validate_required_string(file, data, "type", :okf)
      validate_standard_fields(file, data)
      validate_profile_fields(file, data) unless @okf_only
      validate_sources(file, data, parsed[:body])
      validate_markdown_links(file, parsed[:body])
    end

    def validate_standard_fields(file, data)
      status = data["status"]
      if status && !STATUS_VALUES.include?(status.to_s)
        add(:error, :okf, file, 1, "STATUS_INVALID", "`status` must be draft, stable, or deprecated.")
      end

      tags = data["tags"]
      if tags && (!tags.is_a?(Array) || tags.any? { |tag| !tag.is_a?(String) || tag.strip.empty? })
        add(:error, :okf, file, 1, "TAGS_INVALID", "`tags` must be a list of non-empty strings.")
      elsif tags && tags.uniq.length != tags.length
        add(:error, :okf, file, 1, "TAGS_DUPLICATE", "`tags` must not contain duplicates.")
      end

      generated = data["generated"]
      validate_actor_event(file, generated, "generated") if generated

      verified = normalize_events(data["verified"])
      if data.key?("verified") && !verified
        add(:error, :okf, file, 1, "VERIFIED_INVALID", "`verified` must be an event mapping or a list of event mappings.")
      else
        verified.to_a.each { |event| validate_actor_event(file, event, "verified") }
      end

      stale = data["stale_after"]
      if stale
        date = iso_date(stale)
        if date.nil?
          add(:error, :okf, file, 1, "STALE_AFTER_INVALID", "`stale_after` must be an ISO date (`YYYY-MM-DD`).")
        elsif @today >= date
          severity = data.dig("publication", "status") == "approved" ? :error : :warning
          code = severity == :error ? "PUBLISH_APPROVAL_EXPIRED" : "CONCEPT_STALE"
          add(severity, severity == :error ? :profile : :quality, file, 1, code, "Concept became stale on #{date}.")
        end
      end
    end

    def validate_profile_fields(file, data)
      %w[title description owner visibility status].each do |field|
        validate_required_string(file, data, field, :profile)
      end

      generated = data["generated"]
      unless generated.is_a?(Hash)
        add(:error, :profile, file, 1, "GENERATED_REQUIRED", "Local profile requires a `generated` mapping.")
      end

      owner = data["owner"].to_s
      if !owner.empty? && !owner.match?(/\A(?:human|team):[^\s]+\z/)
        add(:error, :profile, file, 1, "OWNER_INVALID", "`owner` must use `human:<id>` or `team:<id>`.")
      end

      visibility = data["visibility"].to_s
      if !visibility.empty? && !VISIBILITY_VALUES.include?(visibility)
        add(:error, :profile, file, 1, "VISIBILITY_INVALID", "`visibility` must be public or internal.")
      end

      publication = data["publication"]
      unless publication.is_a?(Hash)
        add(:error, :profile, file, 1, "PUBLICATION_REQUIRED", "Local profile requires a `publication` mapping; missing values fail closed.")
        return
      end

      publication_status = publication["status"].to_s
      unless PUBLICATION_VALUES.include?(publication_status)
        add(:error, :profile, file, 1, "PUBLICATION_STATUS_INVALID", "Publication status must be approved, review-required, or prohibited.")
        return
      end

      return unless publication_status == "approved"

      add(:error, :profile, file, 1, "APPROVED_NOT_PUBLIC", "Approved concepts must have public visibility.") unless visibility == "public"
      add(:error, :profile, file, 1, "APPROVED_NOT_STABLE", "Approved concepts must have stable lifecycle status.") unless data["status"] == "stable"
      add(:error, :profile, file, 1, "APPROVED_WITHOUT_SOURCES", "Approved concepts require at least one source.") unless data["sources"].is_a?(Array) && !data["sources"].empty?
      add(:error, :profile, file, 1, "APPROVED_WITHOUT_FRESHNESS", "Approved concepts require `stale_after`.") unless data["stale_after"]

      generated_at = iso_time(data.dig("generated", "at"))
      publication_at = iso_time(publication["at"])
      unless publication["by"].to_s.start_with?("human:")
        add(:error, :profile, file, 1, "APPROVAL_ACTOR_INVALID", "Approved concepts require `publication.by` with a human actor.")
      end
      add(:error, :profile, file, 1, "APPROVAL_TIME_INVALID", "Approved concepts require a valid `publication.at` datetime.") unless publication_at
      if generated_at && publication_at && publication_at < generated_at
        add(:error, :profile, file, 1, "APPROVAL_PREDATES_CONTENT", "Publication approval predates the current content.")
      end

      current_human_verification = normalize_events(data["verified"]).to_a.any? do |event|
        event.is_a?(Hash) && event["by"].to_s.start_with?("human:") &&
          iso_time(event["at"]) && generated_at && iso_time(event["at"]) >= generated_at
      end
      unless current_human_verification
        add(:error, :profile, file, 1, "APPROVED_WITHOUT_CURRENT_HUMAN_VERIFICATION", "Approved concepts require human verification at or after generation.")
      end
    end

    def validate_sources(file, data, body)
      sources = data["sources"]
      return unless sources
      unless sources.is_a?(Array)
        add(:error, :okf, file, 1, "SOURCES_INVALID", "`sources` must be a list.")
        return
      end

      ids = Set.new
      sources.each do |source|
        unless source.is_a?(Hash)
          add(:error, :okf, file, 1, "SOURCE_INVALID", "Every source must be a mapping.")
          next
        end
        resource = source["resource"]
        if !resource.is_a?(String) || resource.strip.empty?
          add(:error, :okf, file, 1, "SOURCE_RESOURCE_REQUIRED", "Every source requires a non-empty `resource`.")
        else
          validate_path_value(file, resource, "SOURCE_TARGET")
        end
        id = source["id"]
        next unless id
        if ids.include?(id.to_s)
          add(:error, :okf, file, 1, "SOURCE_ID_DUPLICATE", "Duplicate source id `#{id}`.")
        end
        ids.add(id.to_s)
      end

      body.scan(/\[\^([A-Za-z0-9_-]+)\]/).flatten.uniq.each do |footnote_id|
        unless ids.include?(footnote_id)
          add(:error, :quality, file, 1, "SOURCE_FOOTNOTE_UNRESOLVED", "Footnote `#{footnote_id}` has no matching `sources[].id`.")
        end
      end
    end

    def validate_actor_event(file, event, field)
      unless event.is_a?(Hash)
        add(:error, :okf, file, 1, "#{field.upcase}_INVALID", "`#{field}` must be a mapping.")
        return
      end
      actor = event["by"].to_s
      unless actor.match?(/\A(?:human:[^\s]+|process:[^\s]+|[^\s\/]+\/[^\s\/]+)\z/)
        add(:error, :okf, file, 1, "ACTOR_INVALID", "`#{field}.by` is not a valid OKF actor.")
      end
      unless iso_time(event["at"])
        add(:error, :okf, file, 1, "DATETIME_INVALID", "`#{field}.at` must be an ISO 8601 datetime.")
      end
    end

    def validate_required_string(file, data, field, layer)
      value = data[field]
      return if value.is_a?(String) && !value.strip.empty?

      add(:error, layer, file, 1, "#{field.upcase}_REQUIRED", "`#{field}` must be a non-empty string.")
    end

    def normalize_events(value)
      return [] if value.nil?
      return [value] if value.is_a?(Hash)
      return value if value.is_a?(Array) && value.all? { |item| item.is_a?(Hash) }

      nil
    end

    def validate_markdown_links(file, body)
      body.scan(/!?\[[^\]]*\]\(([^)]+)\)/).flatten.each do |raw_target|
        target = raw_target.strip
        target = target[1...-1] if target.start_with?("<") && target.end_with?(">")
        target = target.split(/\s+["']/, 2).first
        validate_path_value(file, target, "BROKEN_LINK")
      end
    end

    def validate_path_value(file, raw_target, code)
      target = raw_target.to_s.strip
      return if target.empty? || target.start_with?("#")

      if target.match?(/\Ahttps?:\/\//i)
        begin
          uri = URI.parse(target)
          raise URI::InvalidURIError unless uri.host
        rescue URI::InvalidURIError
          add(:error, :quality, file, 1, "URL_INVALID", "Invalid external URL `#{target}`.")
        end
        return
      end
      return if target.match?(/\A[a-z][a-z0-9+.-]*:/i)

      clean = target.split("#", 2).first.split("?", 2).first
      return if clean.empty?
      resolved = clean.start_with?("/") ? @bundle.join(clean.delete_prefix("/")) : file.dirname.join(clean)
      resolved = resolved.cleanpath.expand_path

      unless within?(resolved, @repository_root)
        add(:error, :quality, file, 1, "PATH_ESCAPES_REPOSITORY", "Local target escapes the repository: `#{target}`.")
        return
      end
      unless resolved.exist?
        add(:error, :quality, file, 1, code, "Local target does not exist: `#{target}`.")
        return
      end
      unless exact_case?(resolved)
        add(:error, :quality, file, 1, "PATH_CASE_MISMATCH", "Local target uses different path casing: `#{target}`.")
      end
    end

    def validate_index_coverage
      knowledge_directories.each do |directory|
        concepts = directory.children.select { |path| path.file? && path.extname == ".md" && !RESERVED_FILES.include?(path.basename.to_s) }
        child_directories = directory.children.select do |path|
          path.directory? && Dir.glob(path.join("**", "*.md").to_s).any?
        end
        required = (concepts + child_directories).map(&:expand_path)
        next if required.empty?

        index = directory.join("index.md")
        unless index.file?
          add(:error, :quality, directory, 1, "INDEX_MISSING", "Knowledge directory requires an index.md.")
          next
        end

        counts = Hash.new(0)
        parsed = parse_frontmatter(index)
        parsed[:body].scan(/!?\[[^\]]*\]\(([^)]+)\)/).flatten.each do |raw_target|
          target = raw_target.strip.split("#", 2).first.split("?", 2).first
          next if target.empty? || target.match?(/\A[a-z][a-z0-9+.-]*:/i)
          resolved = target.start_with?("/") ? @bundle.join(target.delete_prefix("/")) : directory.join(target)
          counts[resolved.cleanpath.expand_path.to_s] += 1
        end

        required.each do |target|
          count = counts[target.to_s]
          if count.zero?
            add(:error, :quality, index, 1, "INDEX_ENTRY_MISSING", "Index does not list direct child `#{target.basename}`.")
          elsif count > 1
            add(:error, :quality, index, 1, "INDEX_ENTRY_DUPLICATE", "Index lists direct child `#{target.basename}` more than once.")
          end
        end
      end
    end

    def knowledge_directories
      directories = [@bundle]
      Dir.glob(@bundle.join("**", "*").to_s).sort.each do |path|
        pathname = Pathname.new(path)
        directories << pathname if pathname.directory?
      end
      directories
    end

    def within?(path, parent)
      path_string = path.to_s
      parent_string = parent.expand_path.to_s
      path_string == parent_string || path_string.start_with?(parent_string + File::SEPARATOR)
    end

    def exact_case?(path)
      return true unless within?(path, @repository_root)

      current = Pathname.new(File::SEPARATOR)
      path.each_filename do |segment|
        entries = Dir.children(current)
        return false unless entries.include?(segment)
        current = current.join(segment)
      rescue SystemCallError
        return false
      end
      true
    end

    def iso_date(value)
      string = value.is_a?(Date) ? value.strftime("%Y-%m-%d") : value.to_s
      return nil unless string.match?(/\A\d{4}-\d{2}-\d{2}\z/)

      Date.iso8601(string)
    rescue Date::Error
      nil
    end

    def iso_time(value)
      return value if value.is_a?(Time)
      string = value.to_s
      return nil unless string.include?("T")

      Time.iso8601(string)
    rescue ArgumentError
      nil
    end

    def add(severity, layer, path, line, code, message)
      diagnostics << Diagnostic.new(
        severity: severity,
        layer: layer,
        path: Pathname.new(path).expand_path.to_s,
        line: line,
        code: code,
        message: message
      )
    end

    def relative(path)
      pathname = Pathname.new(path)
      pathname.relative_path_from(@repository_root).to_s
    rescue ArgumentError
      pathname.to_s
    end
  end

  class CLI
    def self.run(argv)
      options = { strict: false, okf_only: false, json: false, today: Date.today }
      parser = OptionParser.new do |config|
        config.banner = "Usage: ruby scripts/validate_brain.rb [BUNDLE] [options]"
        config.on("--strict", "Treat warnings as failures") { options[:strict] = true }
        config.on("--okf-only", "Check only OKF v0.2 conformance") { options[:okf_only] = true }
        config.on("--today DATE", "Override today's date for deterministic checks") do |value|
          options[:today] = Date.iso8601(value)
        rescue Date::Error
          raise OptionParser::InvalidArgument, "today must use YYYY-MM-DD"
        end
        config.on("--json", "Emit stable JSON diagnostics") { options[:json] = true }
      end

      parser.parse!(argv)
      bundle = argv.shift || "brain"
      raise OptionParser::InvalidArgument, "unexpected arguments: #{argv.join(' ')}" unless argv.empty?
      unless Pathname.new(bundle).directory?
        warn "Bundle directory not found: #{bundle}"
        return 2
      end

      validator = Validator.new(bundle, today: options[:today], okf_only: options[:okf_only])
      diagnostics = validator.run
      if options[:json]
        puts JSON.pretty_generate(
          bundle: Pathname.new(bundle).expand_path.to_s,
          today: options[:today].to_s,
          okf_only: options[:okf_only],
          errors: validator.errors.length,
          warnings: validator.warnings.length,
          diagnostics: diagnostics.map(&:to_h)
        )
      else
        print_text(validator)
      end

      return 1 unless validator.errors.empty?
      return 1 if options[:strict] && !validator.warnings.empty?

      0
    rescue OptionParser::ParseError => error
      warn error.message
      warn parser
      2
    rescue SystemCallError, StandardError => error
      warn "Validation failed to run: #{error.class}: #{error.message}"
      2
    end

    def self.print_text(validator)
      okf_errors = validator.errors.count { |item| item.layer == :okf }
      profile_errors = validator.errors.count { |item| item.layer == :profile }
      quality_errors = validator.errors.count { |item| item.layer == :quality }
      quality_warnings = validator.warnings.length

      puts "OKF v0.2: #{okf_errors.zero? ? 'PASS' : 'FAIL'}"
      puts "Company Brain profile: #{profile_errors.zero? ? 'PASS' : 'FAIL'}"
      puts "Quality: #{quality_errors} errors, #{quality_warnings} warnings"
      return if validator.diagnostics.empty?

      puts
      validator.diagnostics.each do |item|
        path = Pathname.new(item.path)
        display = begin
          path.relative_path_from(Pathname.pwd).to_s
        rescue ArgumentError
          path.to_s
        end
        puts "#{display}:#{item.line} [#{item.severity.to_s.upcase} #{item.code}] #{item.message}"
      end
    end
  end
end

exit CompanyBrain::CLI.run(ARGV) if $PROGRAM_NAME == __FILE__
