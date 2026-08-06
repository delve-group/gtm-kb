.PHONY: validate validate-strict test test-ts check

validate:
	ruby scripts/validate_brain.rb brain

validate-strict:
	ruby scripts/validate_brain.rb brain --strict

test:
	ruby tests/validate_brain_test.rb

test-ts:
	npm test

check:
	npm run check
