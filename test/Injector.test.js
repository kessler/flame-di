var debug = require('debug')('darkmagic_Injector.test')
var path = require('path')
var Injector = require('../lib/Injector.js')
var assert = require('assert')
var util = require('util')
var Module = require('module')
var Dependency = require('../lib/Dependency.js')

describe('Dependency Injector', function () {

	var injector

	describe('basic operation', function () {
		it('clears the cache', function (done) {
			injector.inject(function (dummy) {

				var keys = Object.keys(injector._customCache)
				console.log(keys)
				injector.clearCache()

				var requireCacheKeys = Object.keys(require.cache)
				var customCacheKeys = Object.keys(injector._customCache)

				for (var i = 0; i < keys.length; i++) {
					var key = keys[i]
					assert(requireCacheKeys.indexOf(key) === -1, 'did not expected to find ' + key + ' in require.cache')
				}

				assert.deepEqual(customCacheKeys, ['$injector'])
				assert(require('./lib/dummy') instanceof Function, 'after cache clear, expected require(\'./lib/dummy\')  to be a function not the result')

				done()
			})
		})

		it('invokes', function (done) {
			
			injector.inject(function invoking() {			
				done()
			})
		})

		it('enforces illegal parameter names', function () {
			assert.throws(function () {
				injector.inject(function illegal(toString) {

				})
			})
		})

		it('does not permit adding another injector dependency', function () {
			assert.throws(function () {
				injector.addDependency(new Dependency('$injector'))
			})
		})

		it('invoke a callback after injection is complete', function (done) {
			injector.inject(function (dummyCallbackAsync) {

			}, done)
		})

		it('lets the user override dependencies', function (done) {
			injector.inject(function (http) {
				assert.strictEqual(http, 1)
				done()
			}, {
				http: 1
			})
		})
	})

	describe('overrides dependencies', function () {
		
		it('already injected core dependencies', function (done) {
			injector.inject(function (http) {
				assert.ok(http.hasOwnProperty('STATUS_CODES'))
				assert.strictEqual(http, require('http'))
				
				injector.inject(function (http) {
					assert.strictEqual(http, 2)
					done()
				},  { http: 2 })
			})
		})

		it('already injected local dependencies', function (done) {
			injector.inject(function (dummy) {			
				assert.strictEqual(dummy, 2)
				
				injector.inject(function (dummy) {
					assert.strictEqual(dummy, 3)
					done()
				},  { dummy: 3 })
			})
		})

		it('recently overriden dependencies', function (done) {
			injector.inject(function (http) {
				assert.strictEqual(http, 1)

				injector.inject(function (http) {
					assert.strictEqual(http, 2)
					done()
				},  { http: 2 })
			}, { http: 1})	
		})
	})

	
	describe('exposes api to manually add and remove dependencies', function () {

		it('removeDependency()', function () {
			injector.inject(function remove(dummy) {
				var dependency = injector.getDependencyByName('dummy')				
				assert.ok(dependency instanceof Dependency)

				injector.removeDependency(dependency)

				assert.strictEqual(require.cache[dependency.requireId], undefined)
				assert.strictEqual(injector.getDependencyByName('dummy'), undefined)
			})
		})

		it('addDependency()', function () {

			var dependency = new Dependency('foo')
			dependency.requireId = 'http'

			injector.addDependency(dependency)

			injector.inject(function (foo) {
				assert.strictEqual(foo, require('http'))
			})
		})
	})

	describe('inject()', function () {

		it('itself', function () {
			injector.inject(function($injector) {
				assert.strictEqual($injector, injector)
			})
		})

		it('dependencies from core modules', function (done) {
			injector.inject(function coreModules(http, net) {
				assert.strictEqual(http, require('http'))
				assert.strictEqual(net, require('net'))
				done()
			})
		})

		it('dependencies from node modules', function (done) {

			injector.inject(function nodeModules(eyes, esprima) {
				assert.strictEqual(eyes, require('eyes'))
				assert.strictEqual(esprima, require('esprima'))
				done()
			})
		})

		it('dependencies from search paths', function (done) {

			injector.inject(function searchPaths(dummy, dummy2) {
				assert.strictEqual(dummy, 2)
				assert.strictEqual(dummy2, 1)
				done()
			})
		})

		it('dependencies from node_modules, user modules and core modules', function (done) {

			injector.inject(function (http, eyes, dummy, dummyCallbackAsync) {
				assert.strictEqual(dummy, 2)
				assert.strictEqual(http, require('http'))
				assert.strictEqual(eyes, require('eyes'))
				assert.strictEqual(dummyCallbackAsync, 4)
				done()
			})
		})

		it('actuation', function (done) {
			injector.inject(['dummyCache'])
			injector.inject(function (dummyCache) {
				// this means we were injected once already, which is what I want to make sure
				assert.strictEqual(dummyCache(), 1)
				done()
			})
		})

		it('recursively', function (done) {

			injector.inject(function (dummy2, dummy) {
				assert.strictEqual(dummy2, 1)
				assert.strictEqual(dummy, 2)
				done()
			})
		})

		it('with no dependencies and no return values (dependency invoke only)', function (done) {
			injector.inject(function noDeps(dummyNoReturn) {
				done()
			})
		})

		it('does not inject capitalized functions', function (done) {
			assert.doesNotThrow(function(){
				injector.inject(function capitalized(dummyClass) {
					done()
				})
			})
		})

		it('screams when dependencies are missing', function (done) {
			assert.throws(function () {
				injector.inject(function(dummyMissing) {

				})
			}, verifyError(done, 'Missing'), '"dependency missing"')
		})

		it('does not scream when dependencies are optional', function (done) {
			assert.doesNotThrow(function () {
				// optional does not exist
				injector.inject(function(optional_) {
					done()
				})
			})
		})

		it('does not auto inject external factories if told so', function (done) {
			injector.autoInjectExternalFactories = false
			injector.inject(function(findPort) {
				assert.ok(findPort instanceof Function)
				assert.strictEqual(findPort, require('find-port'))
				done()
			})
		})

		it('does not auto inject local factories if told so', function (done) {
			injector.autoInjectLocalFactories = false

			injector.inject(function(dummy) {
				assert.ok(dummy instanceof Function)
				assert.strictEqual(dummy, require('./lib/dummy'))
				done()
			})
		})

		it('does not inject top level exported functions that are named dontInject', function (done) {
			injector.inject(function(dummyDontInject) {
				assert.ok(dummyDontInject instanceof Function)
				assert.strictEqual(dummyDontInject, require('./lib/dummyDontInject'))
				assert.strictEqual(dummyDontInject(), 123)
				done()
			})
		})

		it('does not inject a function returned from a dependency', function (done) {			
			injector.inject(function (returnFunction) {
				assert.strictEqual(typeof returnFunction, 'function')
				assert.strictEqual(returnFunction(), 1)

				injector.inject(function (returnFunction) {
					assert.strictEqual(typeof returnFunction, 'function')
					assert.strictEqual(returnFunction(), 1)

					done()
				})
			})
		})

		/*
			there was a bug where a dependency d3 was required by another d1 which also required d2
			d2 required d1 as well but d2 is asynchronous. DM would queue d3 as new dependency when resolving d1

			it would also queue d3 as new when resolving d2. d3 exports a function.

			d2 would resolve before d3 for d1, thus the cache now has the exported function of d3 but the d1 resolution process
			still thinks its new so it rerequire it... 
		*/
		it('does not inject a function return from dependency in with an async module involved in the chain (regression)', function(done) {
			
			injector.inject(function zzz(rfDependant, returnFunction) {
				assert.strictEqual(typeof returnFunction, 'function')
				assert.strictEqual(returnFunction(), 1)

				done()
			})	
		})

		// check sync and async
		describe('a dependency via a callback if dependency is a factory and has a last parameter called "callback"', function () {

			it('synchronously with single param', function (done) {
				injector.inject(function sync(dummyCallbackSync) {
					assert.strictEqual(dummyCallbackSync, 3)
					done()
				})
			})

			it('synchronously with multiple params', function (done) {
				injector.inject(function sync(dummyCallbackSyncMulti) {
					assert.strictEqual(dummyCallbackSyncMulti, 9)
					done()
				})
			})

			it('asynchronously with a single param', function (done) {

				injector.inject(function async(dummyCallbackAsync) {
					assert.strictEqual(dummyCallbackAsync, 4)
					done()
				})
			})

			it('asynchronously with multiple params', function (done) {
				injector.inject(function async(dummyCallbackAsyncMulti) {
					assert.strictEqual(dummyCallbackAsyncMulti, 10)
					done()
				})
			})

			it('resolves a hierarchy of callbacks', function () {
				injector.inject(function hierarchy(dummyHierarchy) {
					assert.strictEqual(dummyHierarchy.dummyCallbackAsyncMulti, require('./lib/dummyCallbackAsyncMulti'))
					assert.strictEqual(dummyHierarchy.dummyCallbackAsyncMulti, 10)

					assert.strictEqual(dummyHierarchy.dummyCallbackSyncMulti, require('./lib/dummyCallbackSyncMulti'))
					assert.strictEqual(dummyHierarchy.dummyCallbackSyncMulti, 9)
				})
			})
		})
	})

	describe('use the module system', function () {

		it('cache the injector', function () {				
			assert.strictEqual(injector, injector._customCache['$injector'].object)
		})

		it('factory invocation are only executed once, subsequent injections do not invoke the factory again', function (done) {
			// dummy cache is a module that returns a function
			// that function gives the test access to module internal
			// calls counter.
			// each time dummy cache is required, the counter should increment, thus if the result cache would have
			// broken, dummyCache() would return something higher than 1

			injector.inject(function noDeps(dummyCache) {
			
				var calls = dummyCache()				
				assert.strictEqual(calls, 1)

				injector.inject(function noDeps1(dummyCache) {
			
					var calls = dummyCache()
					assert.strictEqual(calls, 1)
					done()
				})
			})
		})

		it('makes subsequent require() calls return the result of the factory, rather than the exported factory function', function (done) {
			injector.inject(function noDeps1(dummyCache) {
				var calls = dummyCache()
				assert.strictEqual(calls, 1)

				injector.inject(function noDeps2(dummyCache) {
					var actual = require('./lib/dummyCache')
					assert.strictEqual(actual, dummyCache)
					assert.strictEqual(actual(), 1)
					done()
				})
			})
		})

		it('stores the dependency metadata next to the exports in the require cache', function (done) {
			injector.inject(function noDeps1(dummyDontInject) {	
				var moduleKey = path.join(__dirname, 'lib', 'dummyDontInject.js')
				assert.strictEqual(require.cache[moduleKey].darkmagic.name, 'dummyDontInject')
				done()
			})
		})

		it('does not modify modules that are not injectable', function (done) {
			var actual = require('./lib/dummyDontInject').toString()
			var requireCacheKeys = Object.keys(require.cache)
			var moduleKey = path.join(__dirname, 'lib', 'dummyDontInject.js')

			assert.ok(requireCacheKeys.indexOf(moduleKey) > -1)

			injector.inject(function noDeps1(dummyDontInject) {
				assert.strictEqual(require.cache[moduleKey].exports.toString(), actual)
				done()
			})
		})
	})

	describe('detects circular dependencies', function () {

		it('- direct', function (done) {
			assert.throws(function () {
				injector.inject(function (dummyCircular1) {
					done(new Error('should not have been called'))
				})
			}, verifyError(done, 'circular'))
		})

		// it.only('- direct2', function (done) {
		// 	assert.throws(function () {
		// 		injector.inject(function (dummyCallbackAsyncMulti, dummy) {
		// 			done(new Error('should not have been called'))
		// 		})
		// 	}, verifyError(done, 'circular'))
		// })

		it('- indirect', function (done) {
			assert.throws(function () {
				injector.inject(function (dummyCircular3) {
					done(new Error('should not have been called'))
				})
			}, verifyError(done, 'circular'))
		})

		it('- callback', function (done) {
			assert.throws(function () {
				injector.inject(function (dummyCircularAsync1) {
					done(new Error('should not have been called'))
				})
			}, verifyError(done, 'circular'))
		})
	})

	describe('injector.prototype._getFunctionParameters', function () {

		it('extracts the parameters from a function\'s signature', function () {
			function f(a, b, c) {
			}

			var actual = Injector.prototype._getFunctionParameters(f)
			var expected = [ { name: 'a' }, { name: 'b' }, { name: 'c' } ]

			assert.strictEqual(actual.length, 3)

			for (var i = 0; i < actual.length; i++) {
				assert.strictEqual(actual[i].name, expected[i].name)
			}
		})

		it('throws an error if argument is not a function', function () {
			assert.throws(function () {
				Injector.prototype._getFunctionParameters({})
			})
		})

		it('parses anonymous functions', function () {
			var actual = Injector.prototype._getFunctionParameters(function(a, b, c) {})

			var expected = [ { name: 'a' }, { name: 'b' }, { name: 'c' } ]

			assert.strictEqual(actual.length, 3)

			for (var i = 0; i < actual.length; i++) {
				assert.strictEqual(actual[i].name, expected[i].name)
			}
		})

		it('returns an empty array if function has no parameters', function () {
			function f() {}

			var actual = Injector.prototype._getFunctionParameters(f)

			assert.deepEqual(actual, [])
		})
	})

	describe('error handling', function () {
		it('throws an error if no callback is provided, when a dependency reports an error via callback', function () {
			// its harder to test when a true async operation occur in the underlying dependency, so this one is a fake.
			assert.throws(function () {
				injector.inject(function (dummyCallbackAsyncError) {	
					done(new Error('should not be invoked'))				
				})					
			})
		})

		it('invokes a callback instead of throwing an error', function (done) {
			try {
				injector.inject(function (dummyCallbackAsyncError) {
					done(new Error('should not be invoked'))
				}, function (err) {
					assert.strictEqual(err.message, 'woops')
					done()	
				})
			} catch (e) {
				done(new Error('should not have been thrown: ' + e))
			}
		})

		it('many errors', function (done) {
			injector.inject(function (errorDependant1, errorDependant2) {

			}, function (err) {
				assert.ok(err instanceof Error)
				done()
			})
		})
	})
	
	before(function () {
		injector = new Injector({ explicitRealModule: module })
		injector.clearCache()
	})

	beforeEach(function () {		
		injector.autoInjectLocalFactories = true
		injector.autoInjectExternalFactories = false		
	})
	
	afterEach(function () {
		injector.clearCache()
		debug('------------------ done ------------------')
	})	
})

function verifyError(done, keyword) {
	return function(err) {
		// this sucks but so does trying to inherit from Error
		if (err instanceof Error && err.message && err.message.indexOf(keyword) > -1) {
			done()
			return true
		} else {
			done(err)
			return false
		}
	}
}

