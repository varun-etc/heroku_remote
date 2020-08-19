var jsforce = require('jsforce');

process.env.BFO_LOGIN_URL = process.env.BFO_LOGIN_URL || 'https://test.salesforce.com';
process.env.BFO_USERNAME = process.env.BFO_USERNAME || 'faqapi.interfaceuser@bridge-fo.com.preprod19';
process.env.BFO_PASSWORD = process.env.BFO_PASSWORD || 'Kwapi@123';
process.env.BFO_CLIENT_ID = process.env.BFO_CLIENT_ID || '3MVG9ahGHqp.k2_zHolxbafgOAE3Cc0XOrbBBX7n.hTo.ds4u5F96z8DIB0fkNhURFhYYrg0u0nIDzahYv1BD';
process.env.BFO_CLIENT_SECRET = process.env.BFO_CLIENT_SECRET || '8B83B89E7CD4DED4BE5B4780DB32AD469B96EA41F53909BEF0A2EFC9271479F2';
process.env.BFO_ACCESS_TOKEN = process.env.BFO_ACCESS_TOKEN || '00Dg0000006I3YA!AQUAQMr2lU_7cX00NMHOstzGLHrMucRfSMlsDH7EVG5gcQTESHlQD8CbGIiH4mm1UF0S.uVwxYz1T_mhQ6Uf5mGJEu9BeyB_';
process.env.BFO_INSTANCE_URL = process.env.BFO_INSTANCE_URL || 'https://se--PREPROD19.cs17.my.salesforce.com';

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