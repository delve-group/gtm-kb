.PHONY: validate validate-strict test

validate:
	ruby scripts/validate_brain.rb brain

validate-strict:
	ruby scripts/validate_brain.rb brain --strict

test:
	ruby tests/validate_brain_test.rb
