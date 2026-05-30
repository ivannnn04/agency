'use client'

import { useState, useEffect } from 'react'

export interface Rates {
  USD: number
  EUR: number
  date: string
}

const DEFAULTS: Rates = { USD: 41, EUR: 44, date: '' }

export function useRates() {
  const [rates, setRates]   = useState<Rates>(DEFAULTS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json')
      .then(r => r.json())
      .then((data: { cc: string; rate: number; exchangedate: string }[]) => {
        const usd = data.find(r => r.cc === 'USD')
        const eur = data.find(r => r.cc === 'EUR')
        if (usd && eur) setRates({ USD: usd.rate, EUR: eur.rate, date: usd.exchangedate })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  /** Convert any amount+currency → USD */
  function toUSD(amount: number, currency: string): number {
    if (currency === 'USD') return amount
    if (currency === 'UAH') return rates.USD > 0 ? amount / rates.USD : 0
    if (currency === 'EUR') return rates.USD > 0 ? (amount * rates.EUR) / rates.USD : 0
    return amount
  }

  /** Convert any amount+currency → UAH */
  function toUAH(amount: number, currency: string): number {
    if (currency === 'UAH') return amount
    if (currency === 'USD') return amount * rates.USD
    if (currency === 'EUR') return amount * rates.EUR
    return amount
  }

  /** Format as USD string */
  function fmtUSD(amount: number) {
    return '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  }

  return { rates, loading, toUSD, toUAH, fmtUSD }
}
