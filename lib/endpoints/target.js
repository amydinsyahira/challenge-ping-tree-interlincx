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

      const { id, url, value, maxAcceptsPerDay, acceptGeoState, acceptHour } = JSON.parse(rawData)

      // check validation
      if (!url) return res.writeHead(400).end('url parameter is required')
      if (!value) return res.writeHead(400).end('value parameter is required')
      if (!maxAcceptsPerDay) return res.writeHead(400).end('maxAcceptsPerDay parameter is required')
      if (!acceptGeoState) return res.writeHead(400).end('acceptGeoState parameter is required')
      if (!Array.isArray(acceptGeoState)) return res.writeHead(400).end('acceptGeoState parameter should be an array type')
      if (!acceptHour) return res.writeHead(400).end('acceptHour parameter is required')
      if (!Array.isArray(acceptHour)) return res.writeHead(400).end('acceptHour parameter should be an array type')

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
          accept: {
            geoState: {
              $in: acceptGeoState
            },
            hour: {
              $in: acceptHour
            }
          }
        }), function (e) {
          if (e) return res.writeHead(500).end(e.message)

          acceptGeoState.forEach(function (state) {
            redis.hget('accept_geostate', state, function (e, doc) {
              if (e) return res.writeHead(500).end(e.message)
              if (!doc) return redis.hset('accept_geostate', state, JSON.stringify([newId]))
              const geostate = JSON.parse(doc)
              geostate.push(newId)
              redis.hset('accept_geostate', state, JSON.stringify(geostate))
            })
          })
          acceptHour.forEach(function (hour) {
            redis.hget('accept_hour', hour, function (e, doc) {
              if (e) return res.writeHead(500).end(e.message)
              if (!doc) return redis.hset('accept_hour', hour, JSON.stringify([newId]))
              const acchour = JSON.parse(doc)
              acchour.push(newId)
              redis.hset('accept_hour', hour, JSON.stringify(acchour))
            })
          })

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

      let count = 0; const targets = []
      for (const key in doc) {
        if (Object.hasOwnProperty.call(doc, key)) {
          targets.push(JSON.parse(doc[key]))
          count++
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'OK', data: targets, count }))
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
      const { url, value, maxAcceptsPerDay, acceptGeoState, acceptHour } = JSON.parse(rawData)

      // check validation
      if (acceptGeoState && !Array.isArray(acceptGeoState)) return res.writeHead(400).end('acceptGeoState parameter should be an array type')
      if (acceptHour && !Array.isArray(acceptHour)) return res.writeHead(400).end('acceptHour parameter should be an array type')

      // update redis data
      redis.hget('targets', id, function (e, doc) {
        if (e) return res.writeHead(500).end(e.message)
        if (!doc) return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'OK', message: 'The target data was not found' }))

        doc = JSON.parse(doc)

        const oldDoc = doc
        const newDoc = { id, url: url || oldDoc.url, value: value || oldDoc.value, maxAcceptsPerDay: maxAcceptsPerDay || oldDoc.maxAcceptsPerDay, accept: { geoState: { $in: acceptGeoState || oldDoc.accept.geoState.$in }, hour: { $in: acceptHour || oldDoc.accept.hour.$in } } }

        redis.hset('targets', id, JSON.stringify(newDoc), function (e) {
          if (e) return res.writeHead(500).end(e.message)

          oldDoc.accept.geoState.$in.forEach(function (state) {
            redis.hget('accept_geostate', state, function (e, doc) {
              if (e || !doc || !acceptGeoState) return
              let geostate = JSON.parse(doc)
              geostate = removeItemAll(geostate, id)
              redis.hset('accept_geostate', state, JSON.stringify(geostate))
              acceptGeoState.forEach(function (state) {
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

          oldDoc.accept.hour.$in.forEach(function (state) {
            redis.hget('accept_hour', state, function (e, doc) {
              if (e || !doc || !acceptHour) return
              const acchour = JSON.parse(doc)
              redis.hset('accept_hour', state, JSON.stringify(removeItemAll(acchour, id)))
              acceptHour.forEach(function (hour) {
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
