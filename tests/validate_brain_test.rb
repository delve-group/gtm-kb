# frozen_string_literal: true

require "fileutils"
require "minitest/autorun"
require "tmpdir"
require_relative "../scripts/validate_brain"

class ValidateBrainTest < Minitest::Test
  TODAY = Date.new(2026, 8, 6)

  def with_bundle(concept:, index: nil)
    Dir.mktmpdir("company-brain-validator") do |directory|
      root = File.join(directory, "brain")
      FileUtils.mkdir_p(root)
      File.write(File.join(root, "index.md"), index || <<~MARKDOWN)
        ---
        okf_version: "0.2"
        ---
        # Test brain

        * [Concept](concept.md) - Test concept.
      MARKDOWN
      File.write(File.join(root, "concept.md"), concept)
      yield root
    end
  end

  def valid_concept(body: "# Test\n")
    <<~MARKDOWN
      ---
      type: Test Concept
      title: Test concept
      description: A deterministic validator fixture.
      status: stable
      generated: { by: "process:test", at: "2026-08-06T10:00:00Z" }
      stale_after: "2026-09-06"
      owner: team:test
      visibility: internal
      publication:
        status: prohibited
      ---
      #{body}
    MARKDOWN
  end

  def codes(validator)
    validator.diagnostics.map(&:code)
  end

  def test_valid_bundle_passes
    with_bundle(concept: valid_concept) do |root|
      validator = CompanyBrain::Validator.new(root, today: TODAY)
      validator.run
      assert_empty validator.errors
      assert_empty validator.warnings
    end
  end

  def test_missing_type_is_an_okf_error
    concept = valid_concept.sub("type: Test Concept\n", "")
    with_bundle(concept: concept) do |root|
      validator = CompanyBrain::Validator.new(root, today: TODAY)
      validator.run
      assert_includes codes(validator), "TYPE_REQUIRED"
    end
  end

  def test_missing_index_entry_is_a_quality_error
    index = <<~MARKDOWN
      ---
      okf_version: "0.2"
      ---
      # Test brain
    MARKDOWN
    with_bundle(concept: valid_concept, index: index) do |root|
      validator = CompanyBrain::Validator.new(root, today: TODAY)
      validator.run
      assert_includes codes(validator), "INDEX_ENTRY_MISSING"
    end
  end

  def test_broken_local_link_is_an_error
    with_bundle(concept: valid_concept(body: "# Test\n\nSee [missing](missing.md).\n")) do |root|
      validator = CompanyBrain::Validator.new(root, today: TODAY)
      validator.run
      assert_includes codes(validator), "BROKEN_LINK"
    end
  end

  def test_stale_review_required_concept_is_a_warning
    concept = valid_concept
      .sub('stale_after: "2026-09-06"', 'stale_after: "2026-08-06"')
      .sub("visibility: internal", "visibility: public")
      .sub("status: prohibited", "status: review-required")
    with_bundle(concept: concept) do |root|
      validator = CompanyBrain::Validator.new(root, today: TODAY)
      validator.run
      assert_includes codes(validator), "CONCEPT_STALE"
      assert_empty validator.errors
    end
  end

  def test_approved_concept_requires_current_human_verification
    concept = valid_concept
      .sub("visibility: internal", "visibility: public")
      .sub("status: prohibited", <<~YAML.chomp)
        status: approved
        by: human:mike
        at: "2026-08-06T11:00:00Z"
      YAML
      .sub("stale_after:", "sources:\n  - id: source\n    resource: https://example.com/source\nstale_after:")
    with_bundle(concept: concept) do |root|
      validator = CompanyBrain::Validator.new(root, today: TODAY)
      validator.run
      assert_includes codes(validator), "APPROVED_WITHOUT_CURRENT_HUMAN_VERIFICATION"
    end
  end
end
