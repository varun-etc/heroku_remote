var memjs = require('memjs');

//memcache
process.env.MEMCACHE_SERVERS = '';
process.env.MEMCACHE_USERNAME = '';
process.env.MEMCACHE_PASSWORD = '';

//memcache
var client = memjs.Client.create(process.env.MEMCACHEDCLOUD_SERVERS, {
  username: process.env.MEMCACHEDCLOUD_USERNAME,
  password: process.env.MEMCACHEDCLOUD_PASSWORD
});


client.flush((err, resp, body)=>{
	console.log(err);
	console.log(resp);
	console.log(body);
});