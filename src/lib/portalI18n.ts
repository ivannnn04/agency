// Every string the client sees in their workspace, in both languages. The
// language is a setting on the client record, chosen by the admin.

export type PortalLang = 'en' | 'uk'

export const portalLang = (v: unknown): PortalLang => (v === 'uk' ? 'uk' : 'en')
export const portalLocale = (lang: PortalLang) => (lang === 'uk' ? 'uk-UA' : 'en-US')

const ukPlural = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100, b = a % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  return b === 1 ? one : many
}

const en = {
  workspace: 'Client workspace',
  signOut: 'Sign out',
  loading: 'Loading…',
  welcome: (name: string) => (name ? `Welcome back, ${name}` : 'Welcome back'),
  homeSub: 'Everything on your projects with Gudrix, in one place.',
  yourProjects: 'Your projects',
  noProjects: 'No projects yet',
  notLinkedTitle: 'Your account is ready — no projects yet',
  notLinkedBody: (email: string) => `Your email ${email} isn’t linked to any project yet. Contact your Gudrix manager and they’ll add you by this email.`,
  tasks: (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`,
  budget: 'Budget',
  openProject: 'Open project',
  noAccess: 'You don’t have access to this project',
  backToProjects: 'Back to your projects',

  overview: 'Overview', board: 'Board', timeline: 'Timeline', invoices: 'Invoices', notes: 'Notes',
  addTask: 'Add task', addTaskHint: 'Add a task to the backlog', messageTeam: 'Message the team', teamChat: 'Team chat',

  progress: 'Project progress',
  tasksDone: (done: number, total: number) => `${done} of ${total} tasks done`,
  openBoard: 'Open the board',
  start: 'Start', deadline: 'Deadline', notSet: 'Not set',
  daysLeft: (n: number) => (n < 0 ? `${-n} ${-n === 1 ? 'day' : 'days'} past the deadline` : n === 0 ? 'Due today' : `${n} ${n === 1 ? 'day' : 'days'} left`),
  roadmap: 'Roadmap', roadmapEmpty: 'The roadmap will appear here once the team plans the phases.',
  phaseDone: 'Done', phaseLate: 'Running late', phasePlanned: 'Planned', phaseActive: 'In progress',
  done: 'Done', overdue: 'Overdue', openRequests: 'Open requests', hoursLogged: 'Hours logged', team: 'Team',
  deadlines: 'Upcoming deadlines', noDated: 'No dated tasks yet',
  yourTeam: 'Your team', teamAssigning: 'Your team is being assigned',
  changeRequests: 'Your change requests', crEmpty: 'None yet — open a task on the board to request changes',
  crOpen: 'Open', crDone: 'Done', attachedFiles: 'Attached files',

  projectBudget: 'Project budget', noTasks: 'No tasks',
  requestChanges: 'Request changes', crLimit: 'Change request limit reached — contact the team in chat', crTitle: 'Request changes on this task',
  priority: { low: 'Low', medium: 'Medium', high: 'High' } as Record<string, string>,

  invTitle: 'Invoice', invIssued: 'Issued', invAmount: 'Amount', invStatus: 'Status', invFile: 'File',
  invPaid: 'Paid', invDue: 'To be paid', invPaidOn: (d: string) => `Paid ${d}`, invDownload: 'Download', invNone: 'No invoices yet',
  invBilled: 'Total billed', invOutstanding: 'Outstanding',

  addTaskTitle: 'Add a task', addTaskSub: 'It lands in the Backlog — the team will review and schedule it',
  fieldTitle: 'Title', fieldTitlePh: 'What needs to be done?', fieldDetails: 'Details (optional)', fieldDetailsPh: 'Anything that helps the team understand the request',
  cancel: 'Cancel', adding: 'Adding…', addToBacklog: 'Add to Backlog', somethingWrong: 'Something went wrong',
  crOf: (n: number, limit: number) => `${n} of ${limit}`, crPlaceholder: 'Describe what you’d like to change…',
  attach: (mb: number) => `Attach images or files (up to 5, ${mb} MB each)`,
  tooBig: (name: string, mb: number) => `“${name}” is too big — ${mb} MB max`,
  uploadFailed: (name: string, why: string) => `Could not upload “${name}”: ${why}`,
  submitting: 'Submitting…', submitRequest: 'Submit request',

  chatEmpty: 'Write the first message — the team will see it right away',
  chatPlaceholder: 'Message… (@ to mention)', fileTooBig: (mb: number) => `File is too big — ${mb} MB max`,
  bookMeeting: 'Book a meeting with Gudrix', you: 'You',
}

const uk: typeof en = {
  workspace: 'Кабінет клієнта',
  signOut: 'Вийти',
  loading: 'Завантаження…',
  welcome: name => (name ? `З поверненням, ${name}` : 'З поверненням'),
  homeSub: 'Усе про ваші проєкти з Gudrix — в одному місці.',
  yourProjects: 'Ваші проєкти',
  noProjects: 'Проєктів ще немає',
  notLinkedTitle: 'Акаунт готовий — проєктів ще немає',
  notLinkedBody: email => `Ваш email ${email} ще не привʼязаний до жодного проєкту. Напишіть своєму менеджеру Gudrix — він додасть вас за цією адресою.`,
  tasks: n => `${n} ${ukPlural(n, 'задача', 'задачі', 'задач')}`,
  budget: 'Бюджет',
  openProject: 'Відкрити проєкт',
  noAccess: 'У вас немає доступу до цього проєкту',
  backToProjects: 'До ваших проєктів',

  overview: 'Огляд', board: 'Дошка', timeline: 'Таймлайн', invoices: 'Рахунки', notes: 'Нотатки',
  addTask: 'Додати задачу', addTaskHint: 'Додати задачу в беклог', messageTeam: 'Написати команді', teamChat: 'Чат з командою',

  progress: 'Прогрес проєкту',
  tasksDone: (done, total) => `Готово ${done} з ${total} задач`,
  openBoard: 'Відкрити дошку',
  start: 'Старт', deadline: 'Дедлайн', notSet: 'Не задано',
  daysLeft: n => (n < 0 ? `${-n} ${ukPlural(-n, 'день', 'дні', 'днів')} після дедлайну` : n === 0 ? 'Дедлайн сьогодні' : `Залишилось ${n} ${ukPlural(n, 'день', 'дні', 'днів')}`),
  roadmap: 'Роадмап', roadmapEmpty: 'Роадмап зʼявиться тут, щойно команда спланує етапи.',
  phaseDone: 'Готово', phaseLate: 'Із запізненням', phasePlanned: 'Заплановано', phaseActive: 'У роботі',
  done: 'Готово', overdue: 'Прострочено', openRequests: 'Відкриті запити', hoursLogged: 'Витрачено годин', team: 'Команда',
  deadlines: 'Найближчі дедлайни', noDated: 'Задач із датами ще немає',
  yourTeam: 'Ваша команда', teamAssigning: 'Команду ще формуємо',
  changeRequests: 'Ваші запити на зміни', crEmpty: 'Ще немає — відкрийте задачу на дошці, щоб попросити про зміни',
  crOpen: 'Відкрито', crDone: 'Зроблено', attachedFiles: 'Прикріплені файли',

  projectBudget: 'Бюджет проєкту', noTasks: 'Немає задач',
  requestChanges: 'Попросити зміни', crLimit: 'Ліміт запитів на зміни вичерпано — напишіть команді в чат', crTitle: 'Попросити зміни в цій задачі',
  priority: { low: 'Низький', medium: 'Середній', high: 'Високий' },

  invTitle: 'Рахунок', invIssued: 'Виставлено', invAmount: 'Сума', invStatus: 'Статус', invFile: 'Файл',
  invPaid: 'Оплачено', invDue: 'До оплати', invPaidOn: d => `Оплачено ${d}`, invDownload: 'Завантажити', invNone: 'Рахунків ще немає',
  invBilled: 'Усього виставлено', invOutstanding: 'До оплати',

  addTaskTitle: 'Додати задачу', addTaskSub: 'Вона потрапить у беклог — команда перегляне й запланує її',
  fieldTitle: 'Назва', fieldTitlePh: 'Що потрібно зробити?', fieldDetails: 'Деталі (необовʼязково)', fieldDetailsPh: 'Усе, що допоможе команді зрозуміти запит',
  cancel: 'Скасувати', adding: 'Додаю…', addToBacklog: 'Додати в беклог', somethingWrong: 'Щось пішло не так',
  crOf: (n, limit) => `${n} з ${limit}`, crPlaceholder: 'Опишіть, що хочете змінити…',
  attach: mb => `Прикріпити зображення чи файли (до 5, по ${mb} МБ)`,
  tooBig: (name, mb) => `«${name}» завеликий — максимум ${mb} МБ`,
  uploadFailed: (name, why) => `Не вдалося завантажити «${name}»: ${why}`,
  submitting: 'Надсилаю…', submitRequest: 'Надіслати запит',

  chatEmpty: 'Напишіть перше повідомлення — команда побачить його одразу',
  chatPlaceholder: 'Повідомлення… (@ щоб згадати)', fileTooBig: mb => `Файл завеликий — максимум ${mb} МБ`,
  bookMeeting: 'Забронювати зустріч із Gudrix', you: 'Ви',
}

export type PortalText = typeof en
export const PORTAL_TEXT: Record<PortalLang, PortalText> = { en, uk }
