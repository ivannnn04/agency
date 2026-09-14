/* Web Push service worker — shows notifications even when the site and
   browser are closed (Android; on iOS the PWA must be on the home screen). */

self.addEventListener('push', event => {
  let data = {}
  try { data = event.data.json() } catch { /* plain text push */ }
  const title = data.title || 'Gudrix'
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/' },
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) {
          if ('navigate' in c) c.navigate(url)
          return c.focus()
        }
      }
      return clients.openWindow(url)
    })
  )
})
