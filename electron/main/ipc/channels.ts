export const IPC_CHANNELS = [
  'accounts:list',
  'accounts:test',
  'accounts:save',
  'accounts:set-enabled',
  'accounts:remove',
  'mails:list',
  'mails:detail',
  'mails:mark-read',
  'mails:download-attachment',
  'sync:all',
  'sync:account',
  'sync:state',
  'sync:history',
  'settings:get',
  'settings:update',
  'settings:data-path',
  'settings:clear-cache',
  'shell:open-external'
] as const

export type IpcChannel = typeof IPC_CHANNELS[number]
