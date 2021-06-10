var redis = require('../redis')

module.exports = {
  _index: { POST: onIndexPost, GET: onIndexGet },
  _id: { POST: onIdPost, GET: onIdGet }
}

function onIndexPost (req, res) {
  let rawData = ''
  req.on('data', function (chunk) { rawData += chunk })
  req.on('end', function () {
    try {
      if (rawData === '') return res.writeHead(400).end('400 Bad Request')

      const { id, url, value, maxAcceptsPerDay, accept } = JSON.parse(rawData)

      // check validation
      if (!url) return res.writeHead(400).end('url parameter is required')
      if (!value) return res.writeHead(400).end('value parameter is required')
      if (!maxAcceptsPerDay) return res.writeHead(400).end('maxAcceptsPerDay parameter is required')
      if (!accept) return res.writeHead(400).end('accept parameter is required')
      if (typeof accept !== 'object' || Array.isArray(accept)) return res.writeHead(400).end('accept parameter should be an object type')

      // insert to redis
      redis.hlen('targets', function (e, count) {
        if (e) return res.writeHead(500).end(e.message)
        count += 1
        const newId = parseInt(id) || count
        redis.hset('targets', newId, JSON.stringify({
          id: newId,
          url: url,
          value: value,
          maxAcceptsPerDay: maxAcceptsPerDay,
          accept
        }), function (e) {
          if (e) return res.writeHead(500).end(e.message)
          if (accept.geoState && accept.geoState.$in) {
            accept.geoState.$in.forEach(function (state) {
              redis.hget('accept_geostate', state, function (e, doc) {
                if (e) return res.writeHead(500).end(e.message)
                if (!doc) return redis.hset('accept_geostate', state, JSON.stringify([newId]))
                const geostate = JSON.parse(doc)
                geostate.push(newId)
                redis.hset('accept_geostate', state, JSON.stringify(geostate))
              })
            })
          }
          if (accept.hour && accept.hour.$in) {
            accept.hour.$in.forEach(function (hour) {
              redis.hget('accept_hour', hour, function (e, doc) {
                if (e) return res.writeHead(500).end(e.message)
                if (!doc) return redis.hset('accept_hour', hour, JSON.stringify([newId]))
                const acchour = JSON.parse(doc)
                acchour.push(newId)
                redis.hset('accept_hour', hour, JSON.stringify(acchour))
              })
            })
          }

          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'OK', message: 'The target has been created' }))
        })
      })
    } catch (e) {
      if (e.message.indexOf('json')) return res.writeHead(400).end('400 Bad Request')

      console.error(e.message)
      res.writeHead(500).end(e.message)
    }
  })
}

function onIndexGet (req, res) {
  try {
    // get from redis
    redis.hgetall('targets', function (e, doc) {
      if (e) return res.writeHead(500).end(e.message)
      if (!doc) return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'OK', message: 'The target data was empty' }))

      const targets = []
      for (const key in doc) {
        if (Object.hasOwnProperty.call(doc, key)) {
          targets.push(JSON.parse(doc[key]))
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'OK', data: targets }))
    })
  } catch (e) {
    console.error(e.message)
    res.writeHead(500).end(e.message)
  }
}

function onIdPost (req, res, opts) {
  let rawData = ''
  req.on('data', function (chunk) { rawData += chunk })
  req.on('end', function () {
    try {
      const id = parseInt(opts.params.id)
      const { url, value, maxAcceptsPerDay, accept } = JSON.parse(rawData)

      // check validation
      if (accept && (typeof accept !== 'object' || Array.isArray(accept))) return res.writeHead(400).end('accept parameter should be an object type')

      // update redis data
      redis.hget('targets', id, function (e, doc) {
        if (e) return res.writeHead(500).end(e.message)
        if (!doc) return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'OK', message: 'The target data was not found' }))

        doc = JSON.parse(doc)

        const oldDoc = doc
        const newDoc = { id, url: url || oldDoc.url, value: value || oldDoc.value, maxAcceptsPerDay: maxAcceptsPerDay || oldDoc.maxAcceptsPerDay, accept: accept || oldDoc.accept }

        redis.hset('targets', id, JSON.stringify(newDoc), function (e) {
          if (e) return res.writeHead(500).end(e.message)
          if (accept && accept.geoState && accept.geoState.$in) {
            oldDoc.accept.geoState.$in.forEach(function (state) {
              redis.hget('accept_geostate', state, function (e, doc) {
                if (e) return
                if (doc) {
                  const geostate = JSON.parse(doc)
                  redis.hset('accept_geostate', state, JSON.stringify(removeItemAll(geostate, id)))
                }
                accept.geoState.$in.forEach(function (state) {
                  redis.hget('accept_geostate', state, function (e, doc) {
                    if (e) return res.writeHead(500).end(e.message)
                    if (!doc) return redis.hset('accept_geostate', state, JSON.stringify([id]))
                    const geostate = JSON.parse(doc)
                    geostate.push(id)
                    redis.hset('accept_geostate', state, JSON.stringify(geostate))
                  })
                })
              })
            })
          }
          if (accept && accept.hour && accept.hour.$in) {
            oldDoc.accept.hour.$in.forEach(function (state) {
              redis.hget('accept_hour', state, function (e, doc) {
                if (e) return
                if (doc) {
                  const acchour = JSON.parse(doc)
                  redis.hset('accept_hour', state, JSON.stringify(removeItemAll(acchour, id)))
                }
                accept.hour.$in.forEach(function (hour) {
                  redis.hget('accept_hour', hour, function (e, doc) {
                    if (e) return res.writeHead(500).end(e.message)
                    if (!doc) return redis.hset('accept_hour', hour, JSON.stringify([id]))
                    const acchour = JSON.parse(doc)
                    acchour.push(id)
                    redis.hset('accept_hour', hour, JSON.stringify(acchour))
                  })
                })
              })
            })
          }

          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'OK', message: 'The target has been updated' }))
        })
      })
    } catch (e) {
      if (e.message.indexOf('json')) return res.writeHead(400).end('400 Bad Request')

      console.error(e.message)
      res.writeHead(500).end(e.message)
    }
  })
}

function onIdGet (req, res, opts) {
  try {
    const { id } = opts.params

    // get from redis
    redis.hget('targets', id, function (e, doc) {
      if (e) return res.writeHead(500).end(e.message)
      if (!doc) return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'OK', message: 'The target data was not found' }))

      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'OK', data: JSON.parse(doc) }))
    })
  } catch (e) {
    console.error(e.message)
    res.writeHead(500).end(e.message)
  }
}

function removeItemAll (arr, value) {
  var i = 0
  while (i < arr.length) {
    if (parseInt(arr[i]) === parseInt(value)) {
      arr.splice(i, 1)
    } else {
      ++i
    }
  }
  return arr
}
