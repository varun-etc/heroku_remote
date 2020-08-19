var _ = require('underscore')
var moment = require('moment')
var async = require('async')
var express = require('express')

var start = Date.now()
var limit = {}
if(process.env.API_LIMIT && process.env.API_INTERVAL)
  limit.remoteAddress = {value: process.env.API_LIMIT, reset: {interval: process.env.API_INTERVAL, unit: 's'}}

var status = {}
var count = {}
var pass = false //do not limit

module.exports = (type, d, done) => {
  done = done || _.noop
  if (_.isUndefined(d) || !limit[type])
    return done() || true
  count[type] = count[type] || {}
  count[type][d] = count[type][d] || 0
  count[type][d]++

  var now = Date.now()
  status[type] = status[type] || {}
  if (!status[type][d] || (status[type][d].reset <= now))
    status[type][d] = {remaining: limit[type].value, count: 0, reset: +moment().add(limit[type].reset.interval, limit[type].reset.unit)}
  if (status[type][d].remaining > 0)
    status[type][d].remaining--
  status[type][d].count++
  if (status[type][d].remaining)
    return done() || true
  status[type][d].reset = +moment().add(limit[type].reset.interval, limit[type].reset.unit)
	if (pass)
	  return done()
	console.log(`blocked ${type} ${d}`) //blocking log
	done(Math.ceil((status[type][d].reset - now) / 1000)) //retry-after seconds
}

module.exports.router = express.Router().
  use((req, res, next) => {
    if (req.path.match(/^\/socket\.io\//))
      return next()
    var check = {remoteAddress: req.headers['x-forwarded-for'] || req.connection.remoteAddress}
	
    async.eachSeries(_.keys(limit), (type, done) => {
      if (_.isUndefined(check[type]))
        return done()
      var value = check[type]
      module.exports(type, value, err => {
        if (status[type] && status[type][value]) {
          res.set('X-RateLimit-Limit', limit[type].value)
          res.set('X-RateLimit-Remaining', status[type][value].remaining)
          res.set('X-RateLimit-Reset', Math.round(status[type][value].reset / 1000))
        }
        done(err)
      })
    },
    err => {
      if (!err)
        return next()
      res.set('Retry-After', err).sendStatus(429)
    })
  })
