/// <reference types="vite/client" />
import type { UnifiedMailApi } from '../shared/types'

declare global { interface Window { unifiedMail: UnifiedMailApi } }
export {}
