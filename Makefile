lint:
	npx eslint *.js

test:
	$(MAKE) lint
	node --pending-deprecation --trace-deprecation --throw-deprecation --trace-warnings test.js

publish:
	git push -u --tags origin master
	npm publish

update:
	npx updates -cu
	rm -rf node_modules
	npm i

patch:
	$(MAKE) test
	npx ver -C patch
	$(MAKE) publish

minor:
	$(MAKE) test
	npx ver -C minor
	$(MAKE) publish

major:
	$(MAKE) test
	npx ver -C major
	$(MAKE) publish

.PHONY: lint test publish update patch minor major
