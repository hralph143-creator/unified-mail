import { integer, sqliteTable, text, uniqueIndex, index } from 'drizzle-orm/sqlite-core'

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  provider: text('provider').notNull(),
  displayName: text('display_name').notNull(),
  imapHost: text('imap_host').notNull(),
  imapPort: integer('imap_port').notNull(),
  imapSecure: integer('imap_secure', { mode: 'boolean' }).notNull(),
  credentialReference: text('credential_reference').notNull(),
  isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull(),
  connectionStatus: text('connection_status').notNull(),
  lastSyncAt: text('last_sync_at'),
  lastSuccessfulSyncAt: text('last_successful_sync_at'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [uniqueIndex('accounts_email_uq').on(table.email)])

export const credentials = sqliteTable('credentials', {
  id: text('id').primaryKey(),
  encryptedValue: text('encrypted_value').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

export const folders = sqliteTable('folders', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  path: text('path').notNull(),
  uidValidity: text('uid_validity').notNull(),
  uidNext: integer('uid_next'),
  lastSyncedAt: text('last_synced_at').notNull()
}, (table) => [uniqueIndex('folders_identity_uq').on(table.accountId, table.path)])

export const mails = sqliteTable('mails', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  folderPath: text('folder_path').notNull(),
  uidValidity: text('uid_validity').notNull(),
  imapUid: integer('imap_uid').notNull(),
  messageId: text('message_id'),
  senderName: text('sender_name').notNull(),
  senderAddress: text('sender_address').notNull(),
  recipients: text('recipients').notNull(),
  subject: text('subject').notNull(),
  preview: text('preview').notNull(),
  receivedAt: text('received_at').notNull(),
  isRead: integer('is_read', { mode: 'boolean' }).notNull(),
  hasAttachments: integer('has_attachments', { mode: 'boolean' }).notNull(),
  operationPending: integer('operation_pending', { mode: 'boolean' }).notNull(),
  syncStatus: text('sync_status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  uniqueIndex('mails_identity_uq').on(table.accountId, table.folderPath, table.uidValidity, table.imapUid),
  index('mails_unread_received_idx').on(table.isRead, table.receivedAt),
  index('mails_account_idx').on(table.accountId)
])

export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  mailId: text('mail_id').notNull(),
  partIndex: integer('part_index').notNull(),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  contentId: text('content_id')
}, (table) => [uniqueIndex('attachments_part_uq').on(table.mailId, table.partIndex)])

export const syncRuns = sqliteTable('sync_runs', {
  id: text('id').primaryKey(),
  accountId: text('account_id'),
  trigger: text('trigger').notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  status: text('status').notNull(),
  addedCount: integer('added_count').notNull(),
  updatedCount: integer('updated_count').notNull(),
  errorCode: text('error_code'),
  errorMessage: text('error_message')
}, (table) => [index('sync_runs_started_idx').on(table.startedAt)])

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull()
})
