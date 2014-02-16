# flame DI  [![Build Status](https://secure.travis-ci.org/kessler/flame-di.png?branch=master)](http://travis-ci.org/kessler/flame-di)

An experimental highly opinionated dependency injection framwork that:

* relies on code conventions
* resolve dependencies recursively
* promote cleaner code
* promote testability

This di relies heavily on the module system, it does not cache the dependencies you create.

Please read the [dark magic section](#dark-magic---full-disclosure) before proceeding.

## example
###lib/database.js:
```javascript
module.exports = function (config, db, callback) {
	// init db connection etc
	db.connect(config.connectionString, callback)
}
```
###lib/config.js:
```javascript
module.exports = function(rc) {
	return rc('di-example', { httpPort: 1234, connectionString: 'some://thing' })
}
```
###index.js:
```javascript
require('flame-di').inject(function(http, database, config) {
	// do application stuff
	http.createServer(function(request, response) {
		connection.query('select * from moo', function(err, results) {
			response.end(results)
		})
	}).listen(config.httpPort)
})
```
### where are all the require calls?
index.js would typically look like this:
```javascript
var http = require('http')
var database = require('./lib/database')
var config = require('./lib/config')

database(function(err, connection) {
	http.createServer(function(request, response) {
		connection.query('select * from moo', function(err, results) {
			response.end(results)
		})
	}).listen(config.httpPort)
})
```
Flame DI eliminates the need for these declarations by infering the dependencies from the parameters of a function (it does that using [esprima](http://esprima.org/))

## How to

### simple dependency
####simple.js:
```javascript
module.exports = function (http, fs) {
	http.createServer(function(request, response) {
		fs.createReadStream('moo').pipe(response)
	}).listen(8080)
}
```
####index.js
```javascript
require('flame-di').inject(function(simple) {
	// simple server is started but we dont know when its ready
})
```
--------------------------------
### callbacks
#### mooFile.js
```javascript
module.exports = function (fs, callback) {
	fs.readFile('moo', callback)
}
```
#### server.js
```javascript
module.exports = function (http, mooFile, callback) {
	var server = http.createServer(function(request, response) {
		response.write(mooFile)
	})

	server.on('listening', function() {
		callback(null, server)
	})

	server.listen(8080)
}
```
#### index.js
```javascript
require('flame-di').inject(function(http, server) {
	http.get('http://localhost:8080', function(err, response) {
		// response content should be equal to our moo file
	})
})
```
--------------------------------
### returning a value
#### config.js
```javascript
module.exports = function (rc) {
	return rc('myapp', { port: 8080 })
}
```
#### index.js
```javascript
require('flame-di').inject(function(http, config) {
	http.createServer(...).listen(config.port)
})
```
--------------------------------
### getting a dash seperated npm module
this will not work for local files though

#### index.js
```javascript
require('flame-di').inject(function(flameDi) {
	// same as require('flame-di')
})
```

## Dark magic - Full disclosure
This framework uses a lot of "dark magic" tricks that many will view as dangerous. These people are probably right and you should listen to them!

####This module:
- parses function signature and uses the parameters, literally to load modules, first attempting to require them as they are and then by attaching them to various predefined search paths in your local file system

- Attempt to inject and invoke recursively EVERY module that exports a function and override the module system cache with it for that module

- dashify camelCase (camel-case) paramters when trying to find non local node modules

- infer that an exported function is async if the last paramter is called "callback"


TODO:

- provider class factories - parameters that start with an Upper case char will be resolved be looking for a class factory
- static analysis of dependencies
- implement something that will replace flame di with require()s and initializations (code generator)
- publish to npm at some point if this takes off