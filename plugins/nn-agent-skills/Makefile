.PHONY: test test-evolve test-review validate check

# Every test is deterministic and offline: no API calls, no network, seconds to run.
test:
	bash tests/run-tests.sh

test-evolve:
	bash tests/run-tests.sh evolve

test-review:
	bash tests/run-tests.sh review

validate:
	claude plugin validate . --strict

check: test validate
