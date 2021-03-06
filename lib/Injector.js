var debug = require('debug')('darkmagic_Injector')
var Waterfall = require('./Waterfall.js')
var Dependency = require('./Dependency.js')
var path = require('path')
var fs = require('fs')
var esprima = require('esprima')
var util = require('util')
var assert = require('assert')
var EventEmitter = require('events').EventEmitter
var util = require('util')

module.exports = Injector

/* words that cannot be used as parameters */
var ILLEGAL = [ 'toString' ]

util.inherits(Injector, EventEmitter)
function Injector(options) {
	EventEmitter.call(this)

	options = options || {}
	this._customCache = {}
	this.explicitRealModule = options.explicitRealModule

	var realModule = this._getRealModule()

	this._initSearchPaths(path.dirname(realModule.filename))

	var injectorDependency = this.newDependencyObject('$injector')
	injectorDependency.object = this

	this._cacheDependency(injectorDependency, this)

	this.autoInjectLocalFactories = options.autoInjectLocalFactories === undefined ? true : options.autoInjectLocalFactories
	this.autoInjectExternalFactories = options.autoInjectExternalFactories === undefined ? false: options.autoInjectExternalFactories
}

Injector.prototype.inject = function(target, overrides, callback) {

	if (typeof (overrides) === 'function') {
		callback = overrides
		overrides = undefined		
	}

	if (typeof (overrides) === 'object') {
		try {
			this.addOverrides(overrides)
		} catch (e) {
			if (callback) return callback(e)
			throw e
		}
	}

	var realModule = this._getRealModule()
	var params

	// actuation instead of inject, in this scenario we dont finish by calling target
	if (util.isArray(target)) {
		debug('target is an array')
		params = []
		
		for (var i = 0; i < target.length; i++) {
			params.push({ name: target[i] })
		}

		target = actuation
	}

	if (typeof target !== 'function') {
		throw new Error('can only inject functions')
	}

	params = params || this._getFunctionParameters(target)
	var dependency = new Dependency(target.name || 'anonymous')
	
	this._inject(target, params, realModule, dependency, [], this._callbackOrThrow(callback))
}

Injector.prototype._inject = function(target, params, realModule, targetDependency, ancestors, callback) {

	debug('_inject "%s" (%s)', targetDependency.name, typeof target)
	debug('"%s" has %d params', targetDependency.name, params.length)

	if (typeof target !== 'function')
		throw new Error('can only inject functions')

	// if there are no parameters take the short path
	if (params.length === 0) {
		invokeTarget(this, target, targetDependency, false, callback)()
		return
	}

	var _hasCallbackParam = hasCallbackParam(params)

	if (_hasCallbackParam)
		params.pop()
	
	var args = []
	var order = []
	var waterfall = new Waterfall(args)

	// resolve params
	for (var i = 0; i < params.length; i++) {

		var dependencyName = params[i].name

		if (ILLEGAL.indexOf(dependencyName) > -1)
			throw new Error('illegal parameter name ' + dependency)

		var dependency = this.getDependencyByName(dependencyName)

		var exists = dependency !== undefined

		if (exists) {
			var artifact
			
			try {
				artifact = dependency.load(realModule, targetDependency)
			} catch(e) {
				return callback(e)
			}

			args.push(artifact)
			debug('dependency "%s" exists', dependencyName)
		} else {

			debug('dependency "%s" is new', dependencyName)			
			dependency = this.newDependencyObject(dependencyName)	
			order.push(i)
			args.push(injectFunctor(this, realModule, ancestors, dependency, targetDependency))
		}
	}

	debug('running waterfall [%s]', order)
	// after all the dependencies have been resolved, invoke the current dependency	
	waterfall.run(order, invokeTarget(this, target, targetDependency, _hasCallbackParam, callback))
}

function injectFunctor(injector, realModule, ancestors, dependency, parentDependency) {
	return function (callback) {

		var dependencyName = dependency.name		
		debug('injectFunctor("%s" => "%s")', dependencyName, parentDependency.name)

		var artifact 

		try {
			artifact = dependency.load(realModule, parentDependency)			
		} catch (e) {			
			return callback(e)
		}
		
		// missing dependency?
		if (!artifact) {
			if (dependency.isOptional) callback()
			else callback(
				new Error(
					util.format('"%s%s" is Missing dependency "%s"',
						parentDependency.name,
						parentDependency.isFactory ? '(...)' : '', dependencyName)))

			return
		}

		if (dependency.isInjectable()) {
			debug('dependency "%s" is injectable', dependencyName)

			// circular dependencyName
			debug('"%s" ancestors: [%s]', dependencyName, ancestors)			
			if (ancestors && ancestors.indexOf(dependencyName) > -1) {
				callback(new Error(
					util.format('circular dependency detected between "%s" and "%s", dependency chain was: "%s"',
						dependencyName, parentDependency.name, util.inspect(ancestors))))
			} else {
				ancestors = ancestors || []
				ancestors.push(dependencyName)
			}

			var params = injector._getFunctionParameters(artifact)

			injector._inject(artifact, params, realModule, dependency, ancestors, callback)
		} else {
			debug('dependency "%s" not injectable', dependencyName)
			injector._cacheDependency(dependency, artifact)
			callback(null, artifact)
		}
	}
}

function invokeTarget(injector, target, dependency, hasCallbackParam, callback) {
	return function invokeTargetFunctor(err, results) {
		debug('invoking "%s", hasCallbackParam: %s', dependency.name, hasCallbackParam)

		var resolve = resolveDependencyCallback(injector, dependency, callback)

		if (err)
			return resolve(err);

		// invoke the artifact
		if (hasCallbackParam) {
			results.push(resolve)
			target.apply(null, results)
		} else {
			try {
				var returnValue = target.apply(null, results)
				resolve(null, returnValue)
			} catch (e) {
				resolve(e)
			}
		}
	}
}

function resolveDependencyCallback(injector, dependency, next) {
	return function resolveFunctor(err, result) {
		debug('resolved "%s"', dependency.name)
		// not sure this is the right thing to do ...
		if (err) {
			return next(err)
		}

		if (dependency.isInjectable() && result) {
			// this dependency is a factory that resolved successfully,
			// save the results of the invocation for next time. 
			dependency.isFactory = false
			injector._cacheDependency(dependency, result)			
		}

		next(null, result)
	}
}

function hasCallbackParam(params) {
	return params[params.length - 1].name === 'callback'
}

Injector.prototype.addDependency = function (dependency) {
	if (dependency.name === '$injector') {
		throw new Error('cannot add an injector dependency')
	}

	debug('addDependency() "%s"', dependency.name)
	this._cacheDependency(dependency, dependency.load(this._getRealModule(), null))
}

Injector.prototype._cacheDependency = function (dependency, artifact) {
	if (!this.getDependencyByName(dependency.name)) {		
		this.emit('new dependency', dependency, artifact)
	}

	// TOD: consider IoC here, then have two types of dependencies instead of having all these ifs laying around
	if (dependency.object) {
		debug('caching dependency "%s" in custom cache', dependency.name)
		this._customCache[dependency.name] = dependency  
	} else {
		debug('caching "%s" with requireId: "%s"', dependency.name, dependency.requireId)		
		this._customCache[dependency.requireId] = require.cache[dependency.requireId] = { exports: artifact, darkmagic: dependency }
	}
}

Injector.prototype.removeDependency = function (dependency) {
	if (typeof dependency === 'string') {
		dependency = this.getDependencyByName(dependency)

		if (!dependency) {
			// TODO should I throw an exception here ?
			debug('trying to remove a non existent dependency')
			return
		}
	}

	debug('removeDependency() "%s"', dependency.name)
	delete require.cache[dependency.requireId]
	delete this._customCache[dependency.name]
}

Injector.prototype.getDependencyByName = function(name) {
	var cache = require.cache
	
	for (var requireId in cache) {
		if (!cache.hasOwnProperty(requireId)) {
			continue
		}

		var dependency = cache[requireId].darkmagic

		if (dependency && dependency.name === name) {
			debug('dependency %s found in require cache', name)
			return dependency
		}
	}

	if (this._customCache.hasOwnProperty(name)) {
		var customCacheDependency = this._customCache[name]
		
		if (customCacheDependency) {
			debug('dependency %s found in custom cache', name)
			return customCacheDependency
		}
	}
	
	// return nothing otherwise
	return
}

Injector.prototype.addSearchPath = function (p) {
	debug('adding search path "%s"', p)
	this._searchPaths.unshift(p)
}

Injector.prototype.newDependencyObject = function (name) {
	var dependency = new Dependency(name)

	dependency.autoInjectLocalFactories = this.autoInjectLocalFactories
	dependency.autoInjectExternalFactories = this.autoInjectExternalFactories
	dependency.searchPaths(this._searchPaths)

	return dependency
}

Injector.prototype._getFunctionParameters = function (f) {

	var parsed = esprima.parse('__f__f(' + f.toString() + ')')

	var parsedFunction = parsed.body[0].expression.arguments[0]

	if (parsedFunction && parsedFunction.params && parsedFunction.params.length > 0)
		return parsedFunction.params

	return []
}

Injector.prototype._initSearchPaths = function (rootDir) {
	this._searchPaths = []

	var lib1 = path.resolve(rootDir, 'lib')

	// TODO: dont remember why I did this, looks redundant or otherwise obsolete...
	var lib2 = path.resolve(rootDir, '..', 'lib')

	if (this._isDirectory(lib1)) {
		this.addSearchPath(lib1)
	}

	if (this._isDirectory(lib2)) {
		this.addSearchPath(lib2)
	}

	debug('injector initial search paths: %s', util.inspect( this._searchPaths))
}

Injector.prototype._isDirectory = function(dir) {
	return fs.existsSync(dir) && fs.statSync(dir).isDirectory()
}

Injector.prototype._getRealModule = function () {

	// use the thing that required darkmagic
	if (this.explicitRealModule) {		
		debug('using explicitRealModule')
		return this.explicitRealModule
	} 

	if (module.parent && module.parent.parent) {		
		debug('using module.parent.parent')
		return module.parent.parent
	} 

	debug('using require.main')
	return require.main
}

Injector.prototype._callbackOrThrow = function (userCallback) {
	var injector = this

	return function handler(err) {	
		if (typeof userCallback === 'function') {
			return userCallback(err)
		}

		if (err) {
			debug('throwing error because no callback is supplied by the user')
			throw err
		}
	}
}

/*
  *	override with custom dependencies
  */
Injector.prototype.addOverrides = function(overrides) {
	for (var name in overrides) {
		debug('overriding dependency %s', name)
		
		var existing = this.getDependencyByName(name)
		
		if (existing) {
			debug('removing existing dependency %s', name)
			this.removeDependency(existing)
		}

		var dep = new Dependency(name)

		if (typeof overrides[name] === 'string') {
			dep.requireId = overrides[name]
		} else {		
			dep.object = overrides[name]
		}

		this.addDependency(dep)		
	}
}

Injector.prototype.clearCache = function () {
	debug('clearing cache')
	
	var cache = require.cache	
	var customCache = this._customCache

	for (var name in customCache) {
		if (name === '$injector') continue

		if (customCache.hasOwnProperty(name)) {
			delete customCache[name]
		}

		if (cache.hasOwnProperty(name)) {
			delete cache[name]
		}	
	}
}

function actuation() {}