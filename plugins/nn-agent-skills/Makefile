.PHONY: test test-quick test-keep test-datalog validate

test-sort:
	bash tests/bubble-sort/run-test.sh

test-quick:
	bash tests/bubble-sort/run-test.sh --iterations 3

test-keep:
	bash tests/bubble-sort/run-test.sh --keep

test-datalog:
	bash tests/datalog/run-test.sh

validate:
	claude plugin validate . --strict
