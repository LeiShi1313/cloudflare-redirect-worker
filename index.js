const Router = require('./router')
const Routes = require('./routes')

const readRequestBody = async (request) => {
    const { headers } = request
    const contentType = headers.get("content-type") || ""

    if (contentType.includes("application/json")) {
        return await request.json()
    }
    else if (contentType.includes("application/text")) {
        return request.text()
    }
    else if (contentType.includes("text/html")) {
        return request.text()
    }
    else if (contentType.includes("form")) {
        const formData = await request.formData()
        const body = {}
        for (const entry of formData.entries()) {
            body[entry[0]] = entry[1]
        }
        return body
    }
    else {
        return 'file';
    }
}

const makeId = (length) => {
    var result           = '';
    var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for ( var i = 0; i < length; i++ ) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
   }
   return result;
}


/**
 * Example of how router can be used in an application
 *  */
addEventListener('fetch', event => {
    event.respondWith(handleRequest(event))
})

async function handleRequest(event) {
    const r = new Router()
    r.post('/new', async () => {
        const body = await readRequestBody(event.request)
        if (!body.url) {
            return new Response("Not URL found!", { status: 400 })
        }
        try {
            let _ = new URL(body.url)
        } catch(_) {
            return new Response("Not a URL", { status: 400 })
        }
        let idLength = 5
        let dftId = makeId(idLength)
        let dftUrl = await DFT.get(dftId)
        while (dftUrl) {
            dftId = makeId(++idLength)
            dftUrl = await DFT.get(dftId)
        }
        await DFT.put(dftId, body.url, {expirationTtl: 7200})
        return new Response(dftId)
    })
    r.get('/dft/(?<name>[0-9a-zA-Z]+)', async () => {
        const url = new URL(event.request.url)
        const key = url.pathname.match('/dft/(?<name>[0-9a-zA-Z]+)')[1]
        const dftUrl = await DFT.get(key)
        try {
            let _ = new URL(dftUrl)
            return Response.redirect(dftUrl, 302)
        } catch (_) {
            return new Response("URL not found!", { status: 404} )
        }
    })
    for (const path in Routes) {
        r.get(`/${path}`.toLowerCase(), () => {
            url = event.request.url.split('?');
            url[0] = Routes[path];
            return Response.redirect(url.join('?'), 301)
        });
    }

    const resp = await r.route(event.request)
    return resp
}
