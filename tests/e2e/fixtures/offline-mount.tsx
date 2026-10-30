import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from '../../../src/App'
import '../../../src/styles.css'

let root: Root
function mount() {
  root = createRoot(document.getElementById('root')!)
  root.render(<StrictMode><App /></StrictMode>)
}
Object.assign(window, { mountLumen: mount, unmountLumen: () => root.unmount() })
mount()
