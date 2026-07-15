import { useEffect, useMemo, useState } from 'react'

type LevelId = 'kids' | 'level1' | 'level2' | 'russian-test1'
type Phase = 'select' | 'intro' | 'quiz' | 'result'
type QuestionType = 'multiple-choice' | 'note-completion' | 'short-text'

interface Question {
  id: string
  type?: QuestionType
  prompt: string
  options?: string[]
  answerIndex?: number
  answer?: string
  acceptableAnswers?: string[]
}

interface TestLevel {
  id: LevelId
  title: string
  shortTitle: string
  description: string
  sourceDoc: string
  timeLimitMinutes: number
  instructions: string[]
  questions: Question[]
}

interface OpenAnswer {
  prompt: string
  response: string
}

interface ResultPayload {
  candidate: string
  level: string
  score: number
  total: number
  percentage: number
  finishedAt: string
  openAnswers: OpenAnswer[]
}

const levelFiles: Record<LevelId, string> = {
  kids: '/tests/kids.json',
  level1: '/tests/level1.json',
  level2: '/tests/level2.json',
  'russian-test1': '/tests/russian-test1.json',
}

const levelDescriptions: Record<LevelId, string> = {
  kids: 'Vocabulary and basic grammar for younger learners.',
  level1: 'Core grammar and sentence structure for pre-intermediate students.',
  level2: 'Advanced grammar, structure, and context understanding.',
  'russian-test1': 'Russian A1 test with multiple choice, note completion, and open questions.',
}

function getQuestionType(question: Question): QuestionType {
  return question.type ?? 'multiple-choice'
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/ё/g, 'е').replace(/[.,!?;:"«»]/g, '').replace(/\s+/g, ' ')
}

function isGradable(question: Question): boolean {
  const type = getQuestionType(question)
  return type === 'multiple-choice' || type === 'note-completion'
}

function isQuestionCorrect(question: Question, answer: number | string | undefined): boolean {
  const type = getQuestionType(question)
  if (type === 'multiple-choice') {
    return typeof answer === 'number' && answer === question.answerIndex
  }
  if (type === 'note-completion') {
    if (typeof answer !== 'string' || !answer.trim()) {
      return false
    }
    const accepted = question.acceptableAnswers?.length
      ? question.acceptableAnswers
      : question.answer
        ? [question.answer]
        : []
    return accepted.some((candidate) => normalizeText(candidate) === normalizeText(answer))
  }
  return false
}

const fallbackInstructions = [
  'The questions may adapt in difficulty based on your current level.',
  'No points are deducted for incorrect answers.',
  'After moving to the next question, you cannot return back.',
]

async function loadLevel(id: LevelId): Promise<TestLevel> {
  const response = await fetch(levelFiles[id])
  if (!response.ok) {
    throw new Error(`Could not load ${id} test data.`)
  }

  const data = (await response.json()) as TestLevel
  return {
    ...data,
    description: data.description || levelDescriptions[id],
    instructions: data.instructions?.length ? data.instructions : fallbackInstructions,
  }
}

function formatTimer(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

async function sendTelegramResult(payload: ResultPayload): Promise<void> {
  const token = import.meta.env.VITE_TELEGRAM_BOT_TOKEN as string | undefined
  const chatId = import.meta.env.VITE_TELEGRAM_CHAT_ID as string | undefined

  if (!token || !chatId) {
    throw new Error(
      'Missing Telegram configuration. Set VITE_TELEGRAM_BOT_TOKEN and VITE_TELEGRAM_CHAT_ID.',
    )
  }

  const lines = [
    '📘 *Placement Test Result*',
    `👤 Candidate: ${payload.candidate}`,
    `🎯 Level: ${payload.level}`,
    `✅ Score: ${payload.score}/${payload.total}`,
    `📊 Percentage: ${payload.percentage}%`,
    `⏱️ Completed: ${payload.finishedAt}`,
  ]

  if (payload.openAnswers.length > 0) {
    lines.push('', '✍️ *Open answers:*')
    payload.openAnswers.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.prompt}`, `➡️ ${item.response || '—'}`)
    })
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: lines.join('\n'),
      parse_mode: 'Markdown',
    }),
  })

  if (!response.ok) {
    throw new Error('Telegram API request failed.')
  }
}

function App() {
  const [levels, setLevels] = useState<Record<LevelId, TestLevel> | null>(null)
  const [phase, setPhase] = useState<Phase>('select')
  const [selectedLevel, setSelectedLevel] = useState<LevelId | null>(null)
  const [candidateName, setCandidateName] = useState('')
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, number | string>>({})
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [telegramStatus, setTelegramStatus] = useState('')
  const [sendingToTelegram, setSendingToTelegram] = useState(false)
  const [telegramSentForAttempt, setTelegramSentForAttempt] = useState(false)

  useEffect(() => {
    let mounted = true
    void (async () => {
      try {
        const [kids, level1, level2, russianTest1] = await Promise.all([
          loadLevel('kids'),
          loadLevel('level1'),
          loadLevel('level2'),
          loadLevel('russian-test1'),
        ])

        if (mounted) {
          setLevels({ kids, level1, level2, 'russian-test1': russianTest1 })
        }
      } catch (error) {
        if (mounted) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load test banks.')
        }
      }
    })()

    return () => {
      mounted = false
    }
  }, [])

  const levelData = selectedLevel && levels ? levels[selectedLevel] : null
  const currentQuestion = levelData?.questions[currentQuestionIndex]

  useEffect(() => {
    if (phase !== 'quiz' || remainingSeconds <= 0) {
      return
    }

    const timer = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          setPhase('result')
          return 0
        }

        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [phase, remainingSeconds])

  const gradableQuestions = useMemo(
    () => (levelData ? levelData.questions.filter(isGradable) : []),
    [levelData],
  )

  const score = useMemo(() => {
    return gradableQuestions.reduce((total, question) => {
      return isQuestionCorrect(question, answers[question.id]) ? total + 1 : total
    }, 0)
  }, [answers, gradableQuestions])

  const percentage = gradableQuestions.length
    ? Math.round((score / gradableQuestions.length) * 100)
    : 0

  const canStart = Boolean(selectedLevel && candidateName.trim().length >= 2)

  function startLevelIntro(id: LevelId): void {
    setSelectedLevel(id)
    setCurrentQuestionIndex(0)
    setAnswers({})
    setTelegramSentForAttempt(false)
    setTelegramStatus('')
    setPhase('intro')
  }

  function startQuiz(): void {
    if (!levelData) {
      return
    }

    setCurrentQuestionIndex(0)
    setAnswers({})
    setTelegramSentForAttempt(false)
    setTelegramStatus('')
    setRemainingSeconds(levelData.timeLimitMinutes * 60)
    setPhase('quiz')
  }

  function chooseAnswer(index: number): void {
    if (!currentQuestion) {
      return
    }

    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: index }))
  }

  function setTextAnswer(value: string): void {
    if (!currentQuestion) {
      return
    }

    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: value }))
  }

  const currentAnswer = currentQuestion ? answers[currentQuestion.id] : undefined
  const currentType = currentQuestion ? getQuestionType(currentQuestion) : 'multiple-choice'
  const isCurrentAnswered =
    currentType === 'multiple-choice'
      ? typeof currentAnswer === 'number'
      : currentType === 'short-text'
        ? true
        : typeof currentAnswer === 'string' && currentAnswer.trim().length > 0

  function goNext(): void {
    if (!levelData || !currentQuestion) {
      return
    }

    if (currentQuestionIndex >= levelData.questions.length - 1) {
      setPhase('result')
      return
    }

    setCurrentQuestionIndex((prev) => prev + 1)
  }

  async function sendResultToTelegram(): Promise<void> {
    if (!levelData) {
      return
    }

    setTelegramSentForAttempt(true)
    setSendingToTelegram(true)
    setTelegramStatus('Sending result to Telegram...')

    const openAnswers: OpenAnswer[] = levelData.questions
      .filter((question) => getQuestionType(question) === 'short-text')
      .map((question) => {
        const response = answers[question.id]
        return {
          prompt: question.prompt,
          response: typeof response === 'string' ? response.trim() : '',
        }
      })

    try {
      await sendTelegramResult({
        candidate: candidateName.trim(),
        level: levelData.title,
        score,
        total: gradableQuestions.length,
        percentage,
        finishedAt: new Date().toLocaleString(),
        openAnswers,
      })
      setTelegramStatus('Result sent to Telegram successfully.')
    } catch (error) {
      setTelegramStatus(error instanceof Error ? error.message : 'Could not send result to Telegram.')
    } finally {
      setSendingToTelegram(false)
    }
  }

  function resetExam(): void {
    setPhase('select')
    setSelectedLevel(null)
    setCurrentQuestionIndex(0)
    setAnswers({})
    setRemainingSeconds(0)
    setTelegramSentForAttempt(false)
    setTelegramStatus('')
  }

  useEffect(() => {
    if (phase !== 'result' || !levelData || telegramSentForAttempt || sendingToTelegram) {
      return
    }

    void sendResultToTelegram()
  }, [
    phase,
    levelData,
    telegramSentForAttempt,
    sendingToTelegram,
    candidateName,
    score,
    percentage,
  ])

  return (
    <main className="min-h-screen text-slate-800">
      <header className="border-b-4 border-blue-600 bg-slate-50/90">
        <div className="relative mx-auto flex w-full max-w-6xl items-center justify-center px-4 py-3 sm:px-6">
          <img src="/logo.png" alt="Placement center logo" className="h-10 w-auto sm:h-12" />
          {phase === 'quiz' && (
            <div className="absolute right-4 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-blue-900/20 sm:right-6">
              {formatTimer(remainingSeconds)}
            </div>
          )}
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-4 pb-8 pt-8 sm:px-6">
        {loadError && (
          <div className="w-full max-w-3xl rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-red-700">
            {loadError}
          </div>
        )}

        {!levels && !loadError && (
          <div className="glass-card w-full max-w-3xl rounded-2xl px-6 py-8 text-center">
            <p className="font-medium text-slate-600">Loading placement tests...</p>
          </div>
        )}

        {phase === 'select' && levels && (
          <div className="glass-card w-full max-w-4xl rounded-3xl border border-white/70 px-5 py-6 sm:px-8 sm:py-8">
            <p className="text-center text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
              Professional Placement Assessment
            </p>
            <h1 className="mt-2 text-center font-[Sora] text-3xl font-bold text-slate-900 sm:text-4xl">
              Choose Your Test Level
            </h1>
            <p className="mx-auto mt-5 text-center text-sm text-slate-600 sm:text-base">
              Select one of the three tracks and start your timed grammar <br></br>and vocabulary placement exam.
            </p>

            <div className="mx-auto mt-6 max-w-xl">
              <label className="mb-2 block text-sm font-semibold text-slate-700" htmlFor="candidateName">
                Student full name
              </label>
              <input
                id="candidateName"
                type="text"
                value={candidateName}
                onChange={(event) => setCandidateName(event.target.value)}
                placeholder="Enter candidate name"
                className="w-full rounded-xl border border-slate-300 bg-white/90 px-4 py-3 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <div className="mt-7 grid gap-4 md:grid-cols-3">
              {(Object.keys(levels) as LevelId[]).map((id) => {
                const test = levels[id]
                const isSelected = selectedLevel === id
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSelectedLevel(id)}
                    className={`rounded-2xl border px-4 py-5 text-left transition ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50 shadow-lg shadow-blue-900/10'
                        : 'border-slate-200 bg-white/80 hover:border-blue-300 hover:bg-blue-50/70'
                    }`}
                  >
                    <div className="mb-2 inline-flex rounded-full bg-blue-600 px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-white">
                      {test.shortTitle}
                    </div>
                    <h3 className="font-[Sora] text-xl font-semibold text-slate-900">{test.title}</h3>
                    <p className="mt-2 text-sm text-slate-600">{test.description}</p>
                    <p className="mt-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                      {test.questions.length} questions • {test.timeLimitMinutes} minutes
                    </p>
                  </button>
                )
              })}
            </div>

            <div className="mt-8 flex justify-center">
              <button
                type="button"
                disabled={!canStart}
                onClick={() => selectedLevel && startLevelIntro(selectedLevel)}
                className="rounded-full bg-blue-600 px-8 py-3 text-base font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {phase === 'intro' && levelData && (
          <div className="glass-card w-full max-w-2xl overflow-hidden rounded-2xl border border-white/70">
            <div className="bg-slate-100 px-6 py-4 text-center">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500">
                You are about to start the section
              </p>
              <h2 className="mt-2 font-[Sora] text-3xl font-bold text-slate-900">{levelData.title}</h2>
            </div>

            <div className="bg-slate-200/70 px-6 py-5 text-center">
              <p className="text-lg font-semibold text-slate-700">{levelData.shortTitle}</p>
              <p className="text-xl font-extrabold text-slate-900">
                {levelData.questions.length} Questions
              </p>
            </div>

            <div className="px-6 py-5 text-slate-700">
              <ul className="list-disc space-y-2 pl-5 text-sm sm:text-base">
                {levelData.instructions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="px-6 pb-6 pt-2 text-center">
              <button
                type="button"
                onClick={startQuiz}
                className="rounded-full bg-blue-600 px-8 py-3 text-base font-semibold text-white transition hover:bg-blue-700"
              >
                Start Quiz
              </button>
            </div>
          </div>
        )}

        {phase === 'quiz' && levelData && currentQuestion && (
          <>
            <div className="glass-card w-full max-w-2xl rounded-2xl border border-white/70 px-4 py-4 sm:px-5">
              <div className="mb-4 flex items-center justify-end">
                <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white">
                  {currentQuestionIndex + 1}/{levelData.questions.length}
                </span>
              </div>

              <div className="mb-4 inline-flex rounded-full bg-slate-200 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">
                {currentType === 'multiple-choice'
                  ? 'Multiple choice'
                  : currentType === 'note-completion'
                    ? 'Note completion'
                    : 'Open answer'}
              </div>

              <h3 className="mb-5 text-xl font-bold text-slate-900">{currentQuestion.prompt}</h3>

              {currentType === 'multiple-choice' && (
                <div className="space-y-2">
                  {(currentQuestion.options ?? []).map((option, index) => {
                    const selected = answers[currentQuestion.id] === index
                    return (
                      <button
                        key={`${currentQuestion.id}-${option}`}
                        type="button"
                        onClick={() => chooseAnswer(index)}
                        className={`option-enter flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
                          selected
                            ? 'border-blue-500 bg-blue-50 text-blue-900'
                            : 'border-slate-200 bg-slate-100/80 text-slate-700 hover:border-blue-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-5 w-5 rounded-full border-2 ${
                            selected ? 'border-blue-600 bg-blue-600' : 'border-slate-400'
                          }`}
                        />
                        <span className="text-base">{option}</span>
                      </button>
                    )
                  })}
                </div>
              )}

              {currentType === 'note-completion' && (
                <input
                  type="text"
                  value={typeof currentAnswer === 'string' ? currentAnswer : ''}
                  onChange={(event) => setTextAnswer(event.target.value)}
                  placeholder="Введите слово в пропуск"
                  className="w-full rounded-xl border border-slate-300 bg-white/90 px-4 py-3 text-base outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                />
              )}

              {currentType === 'short-text' && (
                <>
                  <textarea
                    value={typeof currentAnswer === 'string' ? currentAnswer : ''}
                    onChange={(event) => setTextAnswer(event.target.value)}
                    placeholder="Напишите свой ответ"
                    rows={4}
                    className="w-full resize-y rounded-xl border border-slate-300 bg-white/90 px-4 py-3 text-base outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    Открытые ответы отправляются преподавателю в Telegram и не оцениваются автоматически.
                  </p>
                </>
              )}
            </div>

            <button
              type="button"
              disabled={!isCurrentAnswered}
              onClick={goNext}
              className="rounded-full bg-blue-500 px-9 py-3 font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {currentQuestionIndex === levelData.questions.length - 1 ? 'Finish' : 'Next'}
            </button>
          </>
        )}

        {phase === 'result' && levelData && (
          <div className="glass-card w-full max-w-2xl rounded-2xl border border-white/70 px-6 py-7 sm:px-8">
            <p className="text-center text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
              Test Completed
            </p>
            <h2 className="mt-2 text-center font-[Sora] text-3xl font-bold text-slate-900 sm:text-4xl">
              {candidateName.trim()}
            </h2>
            <p className="mt-3 text-center text-slate-600">{levelData.title}</p>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-center">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Score</p>
                <p className="mt-1 text-2xl font-extrabold text-slate-900">{score}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-center">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Total</p>
                <p className="mt-1 text-2xl font-extrabold text-slate-900">{gradableQuestions.length}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-center">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Percent</p>
                <p className="mt-1 text-2xl font-extrabold text-blue-700">{percentage}%</p>
              </div>
            </div>

            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button
                type="button"
                onClick={resetExam}
                className="rounded-full bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                New Test
              </button>
            </div>

            {telegramStatus && (
              <p className="mt-4 rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-center text-sm text-slate-700">
                {telegramStatus}
              </p>
            )}
          </div>
        )}
      </section>
    </main>
  )
}

export default App
