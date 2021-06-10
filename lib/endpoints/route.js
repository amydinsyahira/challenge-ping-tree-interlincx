var redis = require('../redis')

module.exports = {
  _index: { POST: onIndexPost }
}

function onIndexPost (req, res) {
  let rawData = ''
  req.on('data', function (chunk) { rawData += chunk })
  req.on('end', function () {
    try {
      if (rawData === '') return res.writeHead(400).end('400 Bad Request')

      const { geoState, publisher, timestamp } = JSON.parse(rawData)

      // check validation
      if (!geoState) return res.writeHead(400).end('geoState parameter is required')
      if (!publisher) return res.writeHead(400).end('publisher parameter is required')
      if (!timestamp) return res.writeHead(400).end('timestamp parameter is required')

      const hourParam = new Date(timestamp)

      // get data from redis
      redis.hget('accept_geostate', geoState, function (err, doc) {
        if (err) return res.writeHead(500).end(err)
        if (!doc) return res.writeHead(406, { 'Content-Type': 'application/json' }).end(JSON.stringify({ decision: 'reject' }))

        const state = JSON.parse(doc)
        redis.hget('accept_hour', hourParam.getUTCHours().toString(), function (err, doc) {
          if (err) return res.writeHead(500).end(err)
          if (!doc) return res.writeHead(406, { 'Content-Type': 'application/json' }).end(JSON.stringify({ decision: 'reject' }))

          const hours = JSON.parse(doc)
          const filtered = state.filter(x => hours.includes(x))
          const uniqueFiltered = filtered.filter(uniqueArray)
          if (!uniqueFiltered) return res.writeHead(406, { 'Content-Type': 'application/json' }).end(JSON.stringify({ decision: 'reject' }))

          let highestValue = 0; let url = ''; let selectMaxAccPerDay = 0; let selectId
          for (let index = 0; index < uniqueFiltered.length; index++) {
            const id = uniqueFiltered[index]
            redis.hget('targets', id, function (err, doc) {
              if (err || !doc) return
              const target = JSON.parse(doc)

              if (highestValue < parseFloat(target.value)) {
                highestValue = parseFloat(target.value)
                url = target.url
                selectMaxAccPerDay = target.maxAcceptsPerDay
                selectId = id
              }
              if (index < uniqueFiltered.length - 1) return

              redis.get(`accept_count:${selectId}`, function (e, doc) {
                if (e) return res.writeHead(406, { 'Content-Type': 'application/json' }).end(JSON.stringify({ decision: 'reject' }))
                const midnight = new Date()
                midnight.setHours(24, 0, 0)
                if (!doc) {
                  redis.set(`accept_count:${selectId}`, 1)
                  redis.expireat(`accept_count:${selectId}`, Math.floor(midnight.getTime() / 1000))
                  return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'OK', url }))
                }
                if (parseInt(doc) + 1 > parseInt(selectMaxAccPerDay)) return res.writeHead(406, { 'Content-Type': 'application/json' }).end(JSON.stringify({ decision: 'reject' }))

                redis.set(`accept_count:${selectId}`, parseInt(doc) + 1)
                redis.expireat(`accept_count:${selectId}`, Math.floor(midnight.getTime() / 1000))
                res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'OK', url }))
              })
            })
          }
        })
      })
    } catch (e) {
      if (e.message.indexOf('json')) return res.writeHead(400).end('400 Bad Request')

      console.error(e.message)
      res.writeHead(500).end(e.message)
    }
  })
}

function uniqueArray (value, index, self) {
  return self.indexOf(value) === index
}