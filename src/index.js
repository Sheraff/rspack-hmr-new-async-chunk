document.body.innerHTML = '<div id="out">loading</div>'
import('./lazy.js')
if (import.meta.webpackHot) {
  import.meta.webpackHot.accept()
}
