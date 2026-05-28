import Link from 'next/link'
import {
  TrendingUp, BarChart2, ArrowDownCircle, ArrowUpCircle,
  FileText, FolderOpen, History, Scale, Target, Activity
} from 'lucide-react'

const reports = [
  {
    href: '/analytics/cash-flow',
    icon: TrendingUp,
    title: 'Гроші / Cash flow',
    description: 'Звіт про рух грошових коштів',
  },
  {
    href: '/analytics/pl',
    icon: BarChart2,
    title: 'P&L',
    description: 'Звіт про прибутки і збитки',
  },
  {
    href: '/analytics/receivables',
    icon: ArrowDownCircle,
    title: 'Дебіторка',
    description: 'Розгорнута дебіторська заборгованість',
  },
  {
    href: '/analytics/payables',
    icon: ArrowUpCircle,
    title: 'Кредиторка',
    description: 'Розгорнута кредиторська заборгованість',
  },
  {
    href: '/analytics/statement',
    icon: FileText,
    title: 'Виписка за рахунком',
    description: 'Звіт з банківських рахунків',
  },
  {
    href: '/analytics/projects',
    icon: FolderOpen,
    title: 'Проекти',
    description: 'Всі ваші проекти, заведені в систему',
  },
  {
    href: '/analytics/balance',
    icon: Scale,
    title: 'Баланс',
    description: 'Звіт про активи та пасиви',
  },
  {
    href: '/analytics/plan-fact',
    icon: Target,
    title: 'План/Факт',
    description: 'Звіт про порівняння планових і фактичних результатів',
  },
  {
    href: '/analytics/financial-metrics',
    icon: Activity,
    title: 'Фінансові показники',
    description: 'EBITDA, маржа та рентабельність',
  },
]

export default function AnalyticsPage() {
  return (
    <div className="p-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {reports.map((report) => {
          const Icon = report.icon
          return (
            <Link
              key={report.href}
              href={report.href}
              className="border border-gray-200 rounded-xl p-5 hover:border-teal-300 hover:shadow-sm transition-all group"
            >
              <Icon size={24} className="text-gray-400 group-hover:text-teal-500 mb-3 transition-colors" />
              <h3 className="font-semibold text-gray-800 mb-1">{report.title}</h3>
              <p className="text-sm text-gray-500">{report.description}</p>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
