export type Currency = 'UAH' | 'USD' | 'EUR'
export type AccountType = 'bank' | 'cash' | 'card' | 'safe'
export type TransactionType = 'income' | 'expense' | 'transfer'

export interface Account {
  id: string
  name: string
  type: AccountType
  currency: Currency
  balance: number
  color: string
  icon?: string
  created_at: string
}

export interface Category {
  id: string
  name: string
  type: 'income' | 'expense'
  parent_id?: string
  color?: string
  children?: Category[]
}

export interface Project {
  id: string
  name: string
  status: 'active' | 'inactive' | 'archived'
  contract_amount?: number | null
  contract_currency?: string
  received_before_app?: number | null
  archived_at?: string | null
  created_at: string
}

export interface Counterparty {
  id: string
  name: string
  created_at: string
}

export interface Transaction {
  id: string
  type: TransactionType
  amount: number
  currency: Currency
  account_id: string
  to_account_id?: string
  category_id?: string
  project_id?: string
  counterparty_id?: string
  date: string
  comment?: string
  document_url?: string
  is_planned: boolean
  created_at: string
  account?: Account
  to_account?: Account
  category?: Category
  project?: Project
  counterparty?: Counterparty
}

export interface Budget {
  id: string
  category_id: string
  year: number
  month: number
  amount: number
  type: 'income' | 'expense'
  category?: Category
}
