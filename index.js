var Request = require('request')
var async = require('async')
const throng = require('throng')
var soqlconnect = require('./bfoconnection');

throng({
  workers: process.env.WEB_CONCURRENCY || 1,
  lifetime: Infinity
}, start)

	process.env.COMMUNITY_URL = process.env.COMMUNITY_URL || 'https://preprod19-secommunities.cs17.force.com/ckmContent';
	process.env.BFO_FEEDBACKOBJ_RECORDTYPEID = process.env.BFO_FEEDBACKOBJ_RECORDTYPEID || '012g00000006YoKAAU';
	process.env.MAX_FETCH = process.env.MAX_FETCH || 50000;
	process.env.MEMCACHE_EXPIRY = process.env.MEMCACHE_EXPIRY || 36000;
	process.env.ALLOWED_ORIGNS = process.env.ALLOWED_ORIGNS || "http://localhost:5000";

	process.env.GCAPTCHA_SECRET = process.env.GCAPTCHA_SECRET || '6LcBYf8UAAAAAAbPh9Qffvvaql0utLfYoh7Ty7KY';
	process.env.GCAPTCHA_URL = process.env.GCAPTCHA_URL || 'https://www.google.com/recaptcha/api/siteverify?';
	//memcache preprod
	process.env.MEMCACHEDCLOUD_SERVERS = 'memcached-11561.c114.us-east-1-4.ec2.cloud.redislabs.com:11561';
	process.env.MEMCACHEDCLOUD_USERNAME = 'memcached-app174990142';
	process.env.MEMCACHEDCLOUD_PASSWORD = 'VKfZjsCtSlakHssGhGi5yEGyBj54nhhT';
	
/*	
var logger = require('logzio-nodejs').createLogger({
	token: process.env.LOGZIO_ACCESS_TOKEN,
	protocol: process.env.LOGZIO_PROTOCOL,
	host: process.env.LOGZIO_HOST,
	port: process.env.LOGZIO_PORT,
	type: process.env.LOGZIO_EVENT_TYPE
});*/
var logger = require('logzio-nodejs').createLogger({
  token: 'tjoqQOceiNlYOItTYwKbWLbsteMkPyxc',
  protocol: 'http',
  host: 'listener.logz.io',
  port: '8070',
  type: 'API-LG'
});

function start(){
	console.log("called start!!!!");
	var _ = require('underscore')
	var express = require('express')
	var bodyParser = require('body-parser')
	var memjs = require('memjs')
	//var jsforce = require('jsforce');
	var moment = require('moment');
	var rateLimiter = require('./rateLimiter')

	var app = express()
	var qs = require('qs')
	var cors = require('cors')
	const PORT = process.env.PORT || 5000
	
	//memcache
	var client = memjs.Client.create(process.env.MEMCACHEDCLOUD_SERVERS, {
	  username: process.env.MEMCACHEDCLOUD_USERNAME,
	  password: process.env.MEMCACHEDCLOUD_PASSWORD
	});
	
	//cors check
	var corsOptionsDelegate = function (req, callback) {
		var corsOptions;
		if (process.env.ALLOWED_ORIGNS.split(',').indexOf(req.header('Origin')) !== -1) {
		  corsOptions = { origin: true } // reflect (enable) the requested origin in the CORS response
		} else {
		  corsOptions = { origin: false } // disable CORS for this request
		}
		callback(null, corsOptions) // callback expects two parameters: error and options
	}
	app.use(bodyParser.json());
	app.use(cors(corsOptionsDelegate)).
	use(require('cookie-parser')()).
	use(require('compression')()).
	use(require('body-parser').raw({
	  limit: '10MB',
	  type: [
		'json',
		'urlencoded'
	  ]
	})).
	use(rateLimiter.router).
	get('/faq/popular/:articleType?/:repo?/:language?', (req, res, next) =>{
	  if(!req.params.articleType || !req.params.repo || !req.params.language){
			throw {message: "Missing one of mandatory parameters lanaguage or Repository or FAQ Number.", errorCode: 'MISSING_PARAMETER'};
		} else{
			next();
		}
	}, function(req, res, next) {
		var cache_key = 'popular.' + req.params.articleType + req.params.repo + req.params.language;

		client.get(cache_key, function(err, val) {
			if(err == null && val != null) {
				res.writeHead(200, {
					'Content-Type': 'application/json'
				});
				res.end(val.toString('utf8'));
			}
			else {
				var filter;
					
				switch (req.params.articleType.toLowerCase()) {
				  case 'pa':
					filter = ` AND CKMEmbedded_Video__c = false AND CKMCategory__c !='GENE'`;
					break;
				  case 'pv':
					filter = ` AND CKMEmbedded_Video__c = True`;
					break;
				  case 'gk':
					filter = ` AND CKMEmbedded_Video__c = false AND CKMCategory__c ='GENE'`;
					break;	
				  default:
					filter = '';
				}
				if(!filter)
					return next({message: "Wrong article type should be one of pa,pv,gk.", errorCode: 'MISSING_PARAMETER'});
				try{
					soqlconnect((err, soqlConn) =>{
						if(err)
							return next(err);
						
						var records = [];
						soqlConn.query(
							`SELECT Title, Answer__c, UrlName, FirstPublishedDate__c, LastModifiedDate,
									(SELECT Comment_if_No__c,Knowledge__c,No__c,Yes__c FROM Knowledge_Customer_Feedback__r),
									(SELECT ProductFormula__c FROM Related_Products__r)
							  FROM  Knowledge__kav
							 WHERE  Language ='${req.params.language}' AND PublishStatus='online'
									AND IsVisibleInPkb = true AND RecordTypeName__c = 'FAQ' 
									AND Repositories__c Includes ('${req.params.repo}') ${filter}
									WITH DATA CATEGORY CKM__c AT Public__c 
									ORDER BY LastModifiedDate DESC`
						)
						.on("record", function(record) {
							records.push(record);
						})
						.on("end", function() {

							if(!records.length)
								return next({message: 'Records not found', errorCode: 'NO_RECORDS', data: []});

							var recordsWithFeedback = records.filter(filterArticle);

							var response;						
							if(!recordsWithFeedback.length){
								response = _.map(records.slice(0,8), formatResponse);
								response = JSON.stringify(response);
							} else {
								recordsWithFeedback.forEach(totalFeedbacks);
								var rankedArticles = recordsWithFeedback.map(assignScore);
								rankedArticles.sort((a, b) => {return b.score - a.score});
								
								response = JSON.stringify(rankedArticles.slice(0,8));
								totalFeedbacksCount =0;
								delete rankedArticles;
							}
							records =[];
							delete recordsWithFeedback;
							//caching with 1 hour expire
							client.set(cache_key, response, {expires: process.env.MEMCACHE_EXPIRY}, function(err, val){
								res.set('Cache-Control', 'public, max-age=3600'); //1 hour
								res.writeHead(200, {
									'Content-Type': 'application/json'
								});
								res.end(response);
							});
						})			  
						.on("error", function(err) {
							if(err)
								return next({message: "Server Error, verify if params are correct /popular/articleType/repo/language.", errorCode: 'INTERNAL_ERROR', errorStack: err});
						}).run({ autoFetch : true, maxFetch : process.env.MAX_FETCH });
					});
				} catch(err){
					next({message: "Server Error", errorCode: 'INTERNAL_ERROR'});
				}
			}
		});
	}).
	get('/faq/all/popular/:repo?/:language?', (req, res, next) =>{
		if(!req.params.repo || !req.params.language){
			  throw {message: "Missing one of mandatory parameters lanaguage or Repository or FAQ Number.", errorCode: 'MISSING_PARAMETER'};
		  } else{
			  next();
		  }
	  }, function(req, res, next) {
		var cache_key = 'articles.all' + req.params.repo + req.params.language;
		try{
			client.get(cache_key, function(err, val) {
				if(err == null && val != null) {
					res.writeHead(200, {
						'Content-Type': 'application/json'
					});
					res.end(val.toString('utf8'));
				} 
				else {					
					soqlconnect((err, soqlConn) =>{
						if(err)
							return next(err);
						async.parallel({
						getPa: function(callback) {
							getPopularArticles({
								repo: req.params.repo, 
								language: req.params.language,
								soqlConn: soqlConn,
								filter: ` AND CKMEmbedded_Video__c = false AND CKMCategory__c !='GENE'`
							}, function(err, data){
								if(err)
									logger.log({message: JSON.stringify(err)});
								callback(null, data);
							});
						},
						getPv: function(callback) {
							getPopularArticles({
								repo: req.params.repo, 
								language: req.params.language,
								soqlConn: soqlConn,
								filter: ` AND CKMEmbedded_Video__c = True`
							}, function(err, data){
								if(err)
									logger.log({message: JSON.stringify(err)});
								callback(null, data);
							});
						},
						getGk: function(callback) {
							getPopularArticles({
								repo: req.params.repo, 
								language: req.params.language,
								soqlConn: soqlConn,
								filter: ` AND CKMEmbedded_Video__c = false AND CKMCategory__c ='GENE'`
							}, function(err, data){
								if(err)
									logger.log({message: JSON.stringify(err)});						
								callback(null, data);
							});
						}				  
						}, function(err, results) {
							client.set(cache_key, JSON.stringify(results), {expires: process.env.MEMCACHE_EXPIRY}, function(err, val){
								res.writeHead(200, {
									'Content-Type': 'application/json'
								});
								res.end(JSON.stringify(results));
							});
						});				
					});
				}
			}); //memcache
		} catch(err){
			next({message: "Server Error", errorCode: 'INTERNAL_ERROR'});
		}
	}).	
	get('/faq/details/:articleId?/:repo?/:language?', (req, res, next) => {
		if(!req.params.articleId || !req.params.repo || !req.params.language){
			throw {message: "Missing one of mandatory parameters lanaguage or Repository or FAQ Number.", errorCode: 'MISSING_PARAMETER'};
		} else{
			next();
		}
	}, function(req, res, next) {
		var cache_key = 'details.' + req.params.articleId + req.params.repo + req.params.language;
		client.get(cache_key, function(err, val) {
			if(err == null && val != null) {
				res.writeHead(200, {
					'Content-Type': 'application/json'
				});
				res.end(val.toString('utf8'));
			} 
			else {
				soqlconnect((err, soqlConn) =>{
					if(err)
						return next(err);
										
					var summary = '';
					var ArticleTotalViewCount =0;
					var products = new Array();
					function setProducts(item, index){
					products.push(item.ProductFormula__c);
					}
					soqlConn.query(
						`SELECT Answer__c,Title, ArticleNumber, KnowledgeArticleId, ArticleTotalViewCount, 
								FirstPublishedDate__c, LastPublishedDate, CKMCategory__c,Language,Repositories__c, 
								(SELECT CategoryName__c,CategoryType__c,ProductFormula__c FROM Related_Products__r where CategoryType__c IN ('CATEGORY','RANGE','')),
								(SELECT contentdocument.title, contentdocumentId, contentdocument.FileExtension from contentdocumentlinks)
						  FROM 	Knowledge__kav 
								WHERE UrlName = '${req.params.articleId}' AND Language ='${req.params.language}' 
								AND PublishStatus='online' AND IsVisibleInPkb = true 
								AND Repositories__c Includes ('${req.params.repo}') UPDATE VIEWSTAT`,
					(err, result) => {
						if (err)
							return next({message: "Server Error, verify if params are correct /knowledge/articleId/repo/language.", errorCode: 'MISSING_PARAMETER', errorStack: err, data: {}});
						
						if(!result.records.length)
							return next({message: 'Records not found', errorCode: 'MISSING_PARAMETER', data: {}});
							
						summary = result.records[0].Answer__c || '';
						
						try{
							trimContent(summary, function(summary) {
								var ContentDocumentLinks = result.records[0].ContentDocumentLinks;
								getAttachments(ContentDocumentLinks, (ContentDocumentLinks) =>{
									ArticleTotalViewCount = result.records[0].ArticleTotalViewCount;

									if(result.records[0].Related_Products__r)
										result.records[0].Related_Products__r.records.forEach(setProducts);

									const article = {
										views: ArticleTotalViewCount,
										articleId: req.params.articleId,
										LastPublishedDate: moment(result.records[0].LastPublishedDate).format('DD/MM/YYYY'),
										firstpublisheddate: moment(result.records[0].FirstPublishedDate__c).format('DD/MM/YYYY'),
										answer: summary,
										FAQLanguage:  result.records[0].Language,
										Countries:  result.records[0].Repositories__c,
										Title: result.records[0].Title,
										ContentDocumentLinks: ContentDocumentLinks,
										products: products.join(', ')
									}
									delete ContentDocumentLinks;
									delete products;
									//caching with 1 hour expire
									client.set(cache_key, JSON.stringify(article), {expires: process.env.MEMCACHE_EXPIRY}, function(err, val){
										res.set('Cache-Control', 'public, max-age=3600'); //1 hour
										res.writeHead(200, {
											'Content-Type': 'application/json'
										});
										res.end(JSON.stringify(article));
									});	
								});
							});
						}catch(err){
							next({message: "Server Error", errorCode: 'INTERNAL_ERROR'});
						}
						
					});
				}); //soql conn
			}//else
		});	
	}).
	get('/faq/products/:articleId?/:repo?/:language?', (req, res, next) => {
		if(!req.params.articleId || !req.params.repo || !req.params.language){
			throw {message: "Missing one of mandatory parameters lanaguage or Repository or FAQ Number", errorCode: 'MISSING_PARAMETER'};
		} else{
			next();
		}
		
	}, function(req, res, next) {
		var cache_key = 'products.' + req.params.articleId + req.params.repo + req.params.language;
		client.get(cache_key, function(err, val) {
			if(err == null && val != null) {
				res.writeHead(200, {
					'Content-Type': 'application/json'
				});
				res.end(val.toString('utf8'));
			}
			else {
				soqlconnect((err, soqlConn) =>{
					if(err)
						return next(err);
										
					soqlConn.query(
						`SELECT  CategoryType__c,CategoryName__c,Category__r.Name, Range__c,
								ProductDerived__c,ProductFormula__c,Category__r.SDHCategoryId__c,
								Product__r.CategoryId__r.Name,Product__r.CategoryId__r.SDHCategoryId__c
							FROM  KnowledgeProduct__c where Knowledge__r.UrlName='${req.params.articleId}'
								AND Knowledge__r.Language='${req.params.language}' 
								AND Knowledge__r.Repositories__c includes ('${req.params.repo}')
								AND Knowledge__r.Publishstatus='Online'
								AND Knowledge__r.IsVisibleInPkb = true`,
					(err, result) => {
						if (err)
							return next({message: "Server Error, verify if params are correct /faq/products/articleId/repo/language.", errorCode: 'INTERNAL_ERROR', errorStack: err});

						if(!result.records.length)
							return next({message: 'Records not found', errorCode: 'NO_RECORDS', data: {}});
						
						var category_type ={
							PRODUCT: 'product',
							RANGE: 'product-range',
							CATEGORY: 'product-category'
						};
						var products = {};
						
						result.records.forEach(function(item) {
							//consider only RANGE, CATEGORY and PRODUCT
							if(!_.contains(['RANGE', 'CATEGORY', null], item.CategoryType__c))
								return;
							if(!item.CategoryType__c)
								item.CategoryType__c ='PRODUCT';
							
							var url = `https://www.se.com/${req.params.repo}/${req.params.language}/${category_type[item.CategoryType__c]}/`;
							if(item.Category__r && item.CategoryType__c != 'PRODUCT')
								url += item.Category__r.SDHCategoryID__c;
							if(item.CategoryType__c == 'PRODUCT')
								url += item.ProductFormula__c;

							if(typeof products[item.CategoryType__c] == 'undefined'){
								products[item.CategoryType__c] = {records:[{name: item.ProductFormula__c, url: url}]}
							}
							else {
								products[item.CategoryType__c].records.push({name: item.ProductFormula__c, url: url});
							}

							//parse product for ranges
							/*
							if(item.CategoryType__c =='PRODUCT' && item.Product__r !== null && item.Product__r.CategoryId__r!==null){
								var rangeURL = `https://www.se.com/${req.params.repo}/${req.params.language}/product-range/${item.Product__r.CategoryId__r.SDHCategoryID__c}`;
								if(typeof products['RANGE'] == 'undefined'){
									products['RANGE'] = {records:[{name: item.Product__r.CategoryId__r.Name, url: rangeURL}]}
								} else {
									var find_range = products['RANGE'].records.find(function(range){
										return range.name == item.Product__r.CategoryId__r.Name;
									});
									if(!find_range)
										products['RANGE'].records.push({name: item.Product__r.CategoryId__r.Name, url: rangeURL});
								}
							}*/
						});
						
						if(_.isEmpty(products))
							return next({message: "No records found", errorCode: 'NO_RECORDS', data: {}});
						//caching with 1 hour expire
						client.set(cache_key, JSON.stringify(products), {expires: process.env.MEMCACHE_EXPIRY}, function(err, val){
							res.set('Cache-Control', 'public, max-age=3600'); //1 hour
							res.writeHead(200, {
								'Content-Type': 'application/json'
							});
							res.end(JSON.stringify(products));
						});

					});
				}); //soql conn
			} //end else
		});
	}).
	get('/faq/ratings/:articleId?/:language?', function (req, res, next) {
		if(!req.params.articleId || !req.params.language)
			res.end(JSON.stringify({errorCode: 'MISSING_PARAMETER', message: 'Required parameters are missing'}));
		try{
			soqlconnect((err, soqlConn) =>{
				if(err)
					return next(err);

				soqlConn.query(`SELECT Count() FROM Knowledge_Customer_Feedback__c 
								WHERE Knowledge__r.UrlName='${req.params.articleId}' AND Knowledge__r.Language='${req.params.language}'
									AND Knowledge__r.IsLatestVersion=true  AND Knowledge__r.IsVisibleInPkb = true`,
				(err, count_all)=> {
					if (err)
						return next({message: "Feedback count all query failed.", errorCode: 'INTERNAL_ERROR', errorStack: err});

					if(count_all.totalSize ==0)
						return next({message: "No records found", errorCode: 'NO_RECORDS', data: {}});

					soqlConn.query(`SELECT Count() FROM Knowledge_Customer_Feedback__c 
									WHERE Knowledge__r.UrlName='${req.params.articleId}' AND Knowledge__r.Language='${req.params.language}'
										AND Knowledge__r.IsLatestVersion=true AND Yes__c=true  AND Knowledge__r.IsVisibleInPkb = true`,
					(err, count)=> {
						if (err) {
								next({message: "Feedback count positive query failed.", errorCode: 'INTERNAL_ERROR'});
						}

						//res.set('Cache-Control', 'public, max-age=3600'); //1 hour
						res.writeHead(200, {
							'Content-Type': 'application/json'
						});					
						res.end(JSON.stringify({total_count: count_all.totalSize, positive_count: count.totalSize, rating: Math.round((count.totalSize/count_all.totalSize)*100)}));					
					});

				});
			}); //soql conn
		} catch (err){
			next({message: "Something went wrong try again.", errorCode: 'INTERNAL_ERROR'});
		}
	}).
	post('/faq/feedback/:articleId?/:language?', (req, res, next) => {

		var feedback = req.body;

		if(!req.params.articleId || !req.params.language || !feedback || typeof feedback.yes!= 'boolean' 
			|| typeof feedback.no!= 'boolean'){
			throw {message: "Missing one of mandatory parameters lanaguage or FAQ Number or feedback details", errorCode: 'MISSING_PARAMETER'};
		} else {
			var recaptcha_url = process.env.GCAPTCHA_URL + qs.stringify({ secret: process.env.GCAPTCHA_SECRET, response: req.body['g-recaptcha-response'], remoteip: req.connection.remoteAddress });
			Request(recaptcha_url, function(error, resp, body) {
				body = JSON.parse(body);
				if(body.success !== undefined && !body.success) {
					return next({ "message": "Captcha validation failed", errorCode: 'MISSING_PARAMETER', errorStack: body });
				}
				next();
			});
		}

	}, function(req, res, next) {	
		//var feedback = _.pick(req.body, 'Yes__c', 'No__c', 'Comment_if_No__c');
		var feedback ={};
		if(typeof req.body.yes !== 'undefined')
			feedback.Yes__c = req.body.yes;
		if(typeof req.body.no !== 'undefined')
			feedback.No__c = req.body.no;
		if(typeof req.body.comments !== 'undefined')
			feedback.Comment_if_No__c = req.body.comments;

		feedback.RecordTypeId = process.env.BFO_FEEDBACKOBJ_RECORDTYPEID;
		try{
			soqlconnect((err, soqlConn) =>{
				if(err)
					return next(err);			
				soqlConn.query(
				`SELECT Id, Title, UrlName
					FROM Knowledge__kav 
					WHERE UrlName = '${req.params.articleId}' AND Language ='${req.params.language}' 
						AND PublishStatus='online' AND IsVisibleInPkb = true`,
				(err, result) => {
					if (err)
						return next({message: "Server Error, verify if params are correct /feedback/articleId/language.", errorCode: 'INTERNAL_ERROR', errorStack: err});

					if(!result.records.length)
						return next({message: 'Records not found', errorCode: 'INTERNAL_ERROR'});
				
					feedback.Knowledge__c = result.records[0].Id;
					try{
						soqlConn.sobject("Knowledge_Customer_Feedback__c").
						create(feedback, function(err, ret) {
							if (err)
								return next({message: "Feedback create failed.", errorCode: 'INTERNAL_ERROR', errorStack: err});

							res.writeHead(200, {
								'Content-Type': 'application/json'
							});
							res.end(JSON.stringify({message: "Successfully added the feedback.", errorCode: null}));
						})
					} catch(err){
						next({message: "Feedback failed.", errorCode: 'INTERNAL_ERROR'});
					}
				});
			}); //soql conn
		}catch(err){
			next({message: "Feedback failed.", errorCode: 'INTERNAL_ERROR'});
		}
	}).
	use(function (err, req, res, next) {
		logger.log({
			message: JSON.stringify(err),
			EVENT_TYPE:process.env.LOGZIO_EVENT_TYPE
		});
		//console.log(JSON.stringify(err));

		if(typeof err.errorCode !='undefined' && err.errorCode == 'MISSING_PARAMETER'){
			res.writeHead(400, {
			'Content-Type': 'application/json'
			});
			if(typeof err.data !='undefined')
				res.end(JSON.stringify(err.data));
			else
				res.end(JSON.stringify(_.pick(err, 'errorCode', 'message')));
		}
		
		if(typeof err.errorCode !='undefined' && err.errorCode == 'NO_RECORDS'){
			res.writeHead(200, {
			'Content-Type': 'application/json'
			});
			if(typeof err.data !='undefined')
				res.end(JSON.stringify(err.data));
			else
				res.end(JSON.stringify(_.pick(err, 'errorCode', 'message')));
		}	
		
		if(typeof err.errorCode !='undefined' && err.errorCode == 'INTERNAL_ERROR'){
			res.writeHead(500, {
			'Content-Type': 'application/json'
			});
			res.end(JSON.stringify(_.pick(err, 'errorCode', 'message')));
		}
	}).listen(PORT);

	var getPopularArticles = (d, done) =>{	
		var records = [];
		d.soqlConn.query(
			`SELECT Title, Answer__c, UrlName, FirstPublishedDate__c, LastModifiedDate,
					(SELECT Comment_if_No__c,Knowledge__c,No__c,Yes__c FROM Knowledge_Customer_Feedback__r),
					(SELECT ProductFormula__c FROM Related_Products__r)
			  FROM  Knowledge__kav
			 WHERE  Language ='${d.language}' AND PublishStatus='online'
					AND IsVisibleInPkb = true AND RecordTypeId ='0121H000000zuCSQAY'
					AND Repositories__c Includes ('${d.repo}') ${d.filter}
					AND Id IN (SELECT Knowledge__c from Knowledge_Customer_Feedback__c)
					WITH DATA CATEGORY CKM__c AT Public__c 
					ORDER BY LastModifiedDate DESC`
		)
		.on("record", function(record) {
			records.push(record);
		})
		.on("end", function() {
			var response=[];						
			if(!records.length){
				fetchTopEight({conn: d.soqlConn, req: {repo: d.repo, language: d.language}, filter: d.filter}, (err, result)=>{
					records =[]; //cleaning					
					if(err)
						return done(err, []);

					response = _.map(result.records, formatResponse);
					return done(null, response);
				})
			} else {
				records.forEach(totalFeedbacks);
				var rankedArticles = records.map(assignScore);
				rankedArticles.sort((a, b) => {return b.score - a.score});
				
				response = rankedArticles.slice(0,8);
				totalFeedbacksCount =0;
				delete rankedArticles;
				records =[];
				return done(null, response);
			}
		})			  
		.on("error", function(err) {
			if(err)
				return done({message: "Server Error, verify if params are correct /articles/all/repo/language.", errorCode: 'INTERNAL_ERROR', errorStack: err}, []);
		}).run({ autoFetch : true, maxFetch : process.env.MAX_FETCH });
	} //popular
	
	var fetchTopEight = (d, done) =>{
		d.conn.query(
			`SELECT Title, Answer__c, UrlName, FirstPublishedDate__c, LastModifiedDate,
					(SELECT Comment_if_No__c,Knowledge__c,No__c,Yes__c FROM Knowledge_Customer_Feedback__r),
					(SELECT ProductFormula__c FROM Related_Products__r)
			  FROM  Knowledge__kav
			 WHERE  Language ='${d.req.language}' AND PublishStatus='online'
					AND IsVisibleInPkb = true AND RecordTypeId ='0121H000000zuCSQAY'
					AND Repositories__c Includes ('${d.req.repo}') ${d.filter}
					WITH DATA CATEGORY CKM__c AT Public__c 
					ORDER BY LastModifiedDate DESC LIMIT 8`,
		(err, result) => {
			if(err)
				return done({message: "Server Error, verify if params are correct /articles/all/repo/language.", errorCode: 'INTERNAL_ERROR', errorStack: err}, []);
			return done(null, result);
		});	
	}

	var totalFeedbacksCount =0;
	function filterArticle(value, index) {
	  return value.Knowledge_Customer_Feedback__r;
	}

	var totalFeedbacks = (value, index) => {
	  totalFeedbacksCount = totalFeedbacksCount + value.Knowledge_Customer_Feedback__r.totalSize;
	}

	//compute the score for each records and sanitize the output
	function assignScore(value, index){
		var sub_total = value.Knowledge_Customer_Feedback__r.totalSize;

		var yesArt = value.Knowledge_Customer_Feedback__r.records.filter(filterYes);
		var yesCount = yesArt.length;

		if(value.Related_Products__r){
		  var products = new Array();
		  value.Related_Products__r.records.forEach(function(item){
			products.push(item.ProductFormula__c);
		  });
		  value.products  = products.join(', ');
		}
		var score = (yesCount/sub_total)+(sub_total/totalFeedbacksCount);
		value.score = score;
		value = formatResponse(value);
		
		return value;
	}
	var formatResponse = (value) => {
		value.firstpublisheddate = moment(value.FirstPublishedDate__c).format('DD/MM/YYYY');
		value.LastModifiedDate = moment(value.LastModifiedDate).format('DD/MM/YYYY');
		value.answer = value.Answer__c;

		delete value.attributes;
		delete value.Knowledge_Customer_Feedback__r;
		delete value.Related_Products__r;
		delete value.FirstPublishedDate__c;
		delete value.Answer__c;
		return value;
	}

	//filter Yes__C: true records
	function filterYes(value, index){
	  return value.Yes__c;
	}

	//replace the img src url with community URLs
	var trimContent = (summary, done) => {
		if(!summary || !summary.match(/<img.*?src=["'](.+?)["']><\/img>/g))
			return done(summary);
		
		var upstring = summary.match(/<img.*?src=["'](.+?)["']><\/img>/g);	
		upstring.forEach(replaceUrl);

		function replaceUrl(item) {
			var img_url = /\/servlet\/servlet\.[^"']+/
			if(!item.match(img_url))
				return;
			var match = item.match(img_url);
			var updatedImg = item.replace(match, process.env.COMMUNITY_URL.concat(match));
			summary = summary.replace(item, updatedImg);
		}
		done(summary);
	}

	//compute attachment links
	var getAttachments = (ContentDocumentLinks, done) => {
		if(!ContentDocumentLinks || !ContentDocumentLinks.totalSize)
			return done([]);
		var attachmentLinks =[];
		ContentDocumentLinks.records.forEach((item)=>{
			var attName = item.ContentDocument.Title;
			if(item.ContentDocument.FileExtension){
				var patExt = `.(${item.ContentDocument.FileExtension})$`;
				var regexPatt = new RegExp(patExt,"g");
				if(!item.ContentDocument.Title.match(regexPatt))
					attName = attName.concat('.').concat(item.ContentDocument.FileExtension);
			}
			attachmentLinks.push({title: attName, url: process.env.COMMUNITY_URL + "/sfc/servlet.shepherd/document/download/" + item.ContentDocumentId});
		})
		done(attachmentLinks);
	}
} //end start
