import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '../shared/types'

const api: Api = {
  platform: process.platform,
  invoke: (channel, ...args) => {
    if (!/^(git|code|env|snap|db|node|deploy|share|update):/.test(channel)) return Promise.reject(new Error(`Blocked channel ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (s) => ipcRenderer.invoke('settings:set', s)
  },
  system: {
    tools: () => ipcRenderer.invoke('system:tools'),
    systemLocale: () => ipcRenderer.invoke('system:locale')
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    action: (name, approot, action) => ipcRenderer.invoke('projects:action', name, approot, action),
    create: (o) => ipcRenderer.invoke('projects:create', o),
    detectType: (path) => ipcRenderer.invoke('projects:detect', path),
    ssh: (approot, name) => ipcRenderer.invoke('projects:ssh', approot, name),
    logs: (approot, name) => ipcRenderer.invoke('projects:logs', approot, name)
  },
  shell: {
    openUrl: (url) => ipcRenderer.invoke('shell:openUrl', url),
    openPath: (path) => ipcRenderer.invoke('shell:openPath', path),
    openEditor: (path) => ipcRenderer.invoke('shell:openEditor', path),
    pickDirectory: () => ipcRenderer.invoke('shell:pickDirectory')
  },
  term: {
    attach: (id) => ipcRenderer.invoke('term:attach', id),
    write: (id, data) => ipcRenderer.send('term:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('term:resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('term:kill', id),
    onData: (cb) => {
      const fn = (_e: unknown, id: string, data: string): void => cb(id, data)
      ipcRenderer.on('term:data', fn)
      return () => ipcRenderer.removeListener('term:data', fn)
    },
    onExit: (cb) => {
      const fn = (_e: unknown, id: string, code: number): void => cb(id, code)
      ipcRenderer.on('term:exit', fn)
      return () => ipcRenderer.removeListener('term:exit', fn)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
