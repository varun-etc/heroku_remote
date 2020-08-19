process.env.NODE_ENV = 'test';

let chai = require('chai');
let chaiHttp = require('chai-http');
let server = require('./');
let should = chai.should();
let articleId = 'FA313024';

chai.use(chaiHttp);

describe('faqapis', () => {
 /*
  * Test the /GET/:id route
  */
  describe('/GET/:pa/:repo/:language popular', () => {
      it('it should GET popular articles list limit 8', (done) => {
        chai.request(server)
            .get('/faq/popular/pa/de/de')
            .end((err, res) => {
                //console.log(res);
                  should.not.exist(err);
                  res.should.have.status(200);
                  res.body.should.be.a('array');
                  //res.body.should.have.property('_id').eql(book.id);
              done();
            });
      });
  });

  describe('/GET/:pv/:repo/:language popular', () => {
    it('it should GET popular video articles list limit 8', (done) => {
      chai.request(server)
          .get('/faq/popular/pv/de/de')
          .end((err, res) => {
              //console.log(res);
                should.not.exist(err);
                res.should.have.status(200);
                res.body.should.be.a('array');
            done();
          });
    });
  });

  describe('/GET/:gk/:repo/:language popular', () => {
    it('it should GET popular video articles list limit 8', (done) => {
      chai.request(server)
          .get('/faq/popular/gk/de/de')
          .end((err, res) => {
              //console.log(res);
                should.not.exist(err);
                res.should.have.status(200);
                res.body.should.be.a('array');
            done();
          });
    });
  });
  describe('/GET/:pa/:repo/ popular', () => {
    it('With wrong url formats it should return 400(bad request) status code', (done) => {
      chai.request(server)
          .get('/faq/popular/pa/de')
          .end((err, res) => {
              //console.log(res);
                //should.not.exist(err);
                res.should.have.status(400);
                //res.body.should.be.a('array');
                //res.body.should.have.property('_id').eql(book.id);
            done();
          });
    });
});

  describe('/details/'+articleId+'/de/de', () => {
    it('it should GET article details', (done) => {
      chai.request(server)
          .get('/faq/details/'+articleId+'/de/de')
          .end((err, res) => {
              //console.log(res);
                should.not.exist(err);
                res.should.have.status(200);
                res.body.should.be.a('object');
                res.body.should.have.property('Answer__c');
            done();
          });
    });
  }); 
  describe('/products/'+articleId+'/de/de', () => {
    it('it should GET product details', (done) => {
      chai.request(server)
          .get('/faq/products/'+articleId+'/de/de')
          .end((err, res) => {
              //console.log(res);
                should.not.exist(err);
                res.should.have.status(200);
                //res.body.should.be.a('object');
            done();
          });
    });
  });

  describe('/faq/ratings/'+articleId+'/de', () => {
    it('it should GET ratings info', (done) => {
      chai.request(server)
          .get('/faq/ratings/'+articleId+'/de')
          .end((err, res) => {
                console.log(res.body);
                should.not.exist(err);
                res.should.have.status(200);
                res.body.should.have.property('rating');
                //res.body.should.be.a('object');
            done();
          });
    });
  });
  describe('/POST/'+articleId+'/de feedback', () => {
    it('it should POST a feedback', (done) => {
        let feedback = {
          "RecordTypeId" : "012g00000006YoKAAU", 
          "Yes__c" : true, 
          "No__c" : false, 
          "Comment_if_No__c" : ""
        }
          chai.request(server)
          .post('/faq/feedback/'+articleId+'/de')
          .send(feedback)
          .end((err, res) => {
				if(typeof feedback['g-recaptcha-response'] == 'undefined' || !feedback['g-recaptcha-response'])
					res.should.have.status(400);
				else
					res.should.have.status(200);
                res.body.should.be.a('object');
            done();
          });
    });
  });
});
