var jsforce = require('jsforce');

module.exports = (done) =>{
	var soqlConn = new jsforce.Connection({instanceUrl: process.env.BFO_INSTANCE_URL, accessToken: process.env.BFO_ACCESS_TOKEN});
	soqlConn.identity(function(err, res) {
		if (!err)
			return done(null, soqlConn);
		soqlConn = new jsforce.Connection({
			oauth2 : {
				// you can change loginUrl to connect to sandbox or prerelease env.
				loginUrl : process.env.BFO_LOGIN_URL,
				grant_type: 'password',
				clientId : process.env.BFO_CLIENT_ID,
				clientSecret : process.env.BFO_CLIENT_SECRET,
				redirectUri : ''
			}
		});
		soqlConn.login(process.env.BFO_USERNAME, process.env.BFO_PASSWORD, (err, userInfo)=> {
			if(err){
				done({message: "auth error", errorCode: "INTERNAL_ERROR", errorStack: err}, null);
			}else{
				process.env.BFO_ACCESS_TOKEN = soqlConn.accessToken;
				process.env.BFO_INSTANCE_URL = soqlConn.instanceUrl;
				done(null, soqlConn);
			}
		});
	});
}