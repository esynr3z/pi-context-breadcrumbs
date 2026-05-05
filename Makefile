NPM ?= npm

.PHONY: bootstrap install lint test check typecheck build ci precommit clean

bootstrap:
	$(NPM) run bootstrap

install:
	$(NPM) install

lint:
	$(NPM) run lint

test:
	$(NPM) test

check typecheck:
	$(NPM) run check

build:
	$(NPM) run build

ci:
	$(NPM) run ci

precommit:
	.githooks/pre-commit

clean:
	rm -rf dist coverage
