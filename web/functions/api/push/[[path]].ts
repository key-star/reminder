const WORKER_ORIGIN = 'https://reminder-push.18368405011.workers.dev'

export async function onRequest(context: { request: Request }): Promise<Response> {
  const { request } = context
  const url = new URL(request.url)
  const target = new URL(`${url.pathname}${url.search}`, WORKER_ORIGIN)

  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
    redirect: 'manual',
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body
  }

  const response = await fetch(target.toString(), init)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
