var fs = require('fs');
var path = require('path');
var socketio = require('socket.io');
var Backend = require('./backend');
var Sync = require('./sync');

exports.Backend = Backend;

exports.createBackend = function() {
    return new Backend();
};

exports.listen = function(server, backends, options) {
    // Configure default options
    options || (options = {});
    options.event || (options.event = 'backend');

    var io = socketio.listen(server);

    io.configure(function() {
      io.set("transports", ["xhr-polling"]);
      io.set("polling duration", 10);

      var path = require('path');
      var HTTPPolling = require(path.join(
        path.dirname(require.resolve('socket.io')),'lib', 'transports','http-polling')
      );
      var XHRPolling = require(path.join(
        path.dirname(require.resolve('socket.io')),'lib','transports','xhr-polling')
      );

      XHRPolling.prototype.doWrite = function(data) {
        HTTPPolling.prototype.doWrite.call(this);

        var headers = {
          'Content-Type': 'text/plain; charset=UTF-8',
          'Content-Length': (data && Buffer.byteLength(data)) || 0
        };

        if (this.req.headers.origin) {
          headers['Access-Control-Allow-Origin'] = '*';
          if (this.req.headers.cookie) {
            headers['Access-Control-Allow-Credentials'] = 'true';
          }
        }

        this.response.writeHead(200, headers);
        this.response.write(data);
        this.log.debug(this.name + ' writing', data);
      };
    });

    // Serve client-side code
    io.static.add('/backbone.io.js', { file: __dirname + '/browser.js' });
    
    // Listen for backend syncs
    Object.keys(backends).forEach(function(backend) {
        io.of(backend).on('connection', function(socket) {
            var sync = new Sync(backend, socket, options);
            
            socket.on('listen', function(callback) {
                callback(options);
            });
            
            socket.on('sync', function(req, callback) {
                sync.handle(backends[backend], req, function(err, result) {
                    callback(err, result);

                    if (!err && req.method !== 'read') {
                        socket.broadcast.emit('synced', req.method, result);
                    }
                });
            });
            
            // Proxy events on the backend to the socket
            var events = { 'created': 'create', 'updated': 'update', 'deleted': 'delete' };
            Object.keys(events).forEach(function(event) {
                backends[backend].on(event, function(model) {
                    socket.emit('synced', events[event], model);
                });
            });
        });  
    });
    
    return io;
};

exports.middleware = {};

fs.readdirSync(path.dirname(__dirname) + '/middleware').forEach(function(filename) {
    var name = path.basename(filename, '.js');
    exports.middleware.__defineGetter__(name, function() {
        return require('../middleware/' + name);
    });
});