/**
 * Jest-only network boundary. Supertest expects address() synchronously after
 * listen(0), so numeric loopback lookup preserves that existing test contract.
 */
const http = require('node:http');
const net = require('node:net');
const dns = require('node:dns');
const key = Symbol.for('piqniq.test.loopbackBoundary');
if (!http.Server.prototype[key]) {
  http.Server.prototype[key] = true;
  const listen = http.Server.prototype.listen;
  http.Server.prototype.listen = function (...args) {
    if (typeof args[0] === 'number') {
      if (typeof args[1] !== 'string') args.splice(1, 0, '127.0.0.1');
      if (args[1] !== '127.0.0.1') throw new Error('Tests must bind HTTP to loopback');
    } else if (args[0] && typeof args[0] === 'object') {
      args[0] = { ...args[0], host: '127.0.0.1' };
    }
    return listen.apply(this, args);
  };
  const lookup = dns.lookup;
  dns.lookup = function (host, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    if (['127.0.0.1', 'localhost', '::1'].includes(host)) {
      const family = host === '::1' ? 6 : 4;
      const address = family === 6 ? '::1' : '127.0.0.1';
      return options?.all ? callback(null, [{ address, family }]) : callback(null, address, family);
    }
    return lookup.call(this, host, options, callback);
  };
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const value = Array.isArray(args[0]) ? args[0][0] : args[0];
    const host = value && typeof value === 'object' ? (value.host || 'localhost') : typeof args[1] === 'string' ? args[1] : 'localhost';
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Test outbound connection blocked');
    return connect.apply(this, args);
  };
}
