import { useMemo, useState } from 'react'
import { CaretDown, CaretLeft, CaretRight } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

function formatDateStamp(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatMonthTitle(year: number, month: number) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month, 1))
}

export function JournalDatePicker({
  ariaLabel = '选择日期',
  className,
  datesWithEntries,
  disabled = false,
  displayValue,
  maxDate,
  minDate,
  onChange,
  value,
}: {
  ariaLabel?: string
  className?: string
  datesWithEntries: string[]
  disabled?: boolean
  displayValue?: string
  maxDate?: string
  minDate?: string
  onChange: (date: string) => void
  value: string
}) {
  const selectedDate = new Date(`${value}T00:00:00`)
  const [displayMonth, setDisplayMonth] = useState(() => ({
    month: selectedDate.getMonth(),
    year: selectedDate.getFullYear(),
  }))
  const entryDates = useMemo(() => new Set(datesWithEntries), [datesWithEntries])
  const firstDay = new Date(displayMonth.year, displayMonth.month, 1)
  const firstWeekday = firstDay.getDay()
  const daysInMonth = new Date(displayMonth.year, displayMonth.month + 1, 0).getDate()
  const previousMonthDays = new Date(displayMonth.year, displayMonth.month, 0).getDate()
  const calendarDays = Array.from({ length: 42 }, (_, index) => {
    const dayOffset = index - firstWeekday + 1
    const date =
      dayOffset < 1
        ? new Date(displayMonth.year, displayMonth.month - 1, previousMonthDays + dayOffset)
        : dayOffset > daysInMonth
          ? new Date(displayMonth.year, displayMonth.month + 1, dayOffset - daysInMonth)
          : new Date(displayMonth.year, displayMonth.month, dayOffset)
    return {
      currentMonth: date.getMonth() === displayMonth.month,
      day: date.getDate(),
      stamp: formatDateStamp(date),
    }
  })

  function changeMonth(delta: number) {
    setDisplayMonth((current) => {
      const date = new Date(current.year, current.month + delta, 1)
      return { month: date.getMonth(), year: date.getFullYear() }
    })
  }

  function isDateDisabled(date: string) {
    return Boolean((minDate && date < minDate) || (maxDate && date > maxDate))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={ariaLabel}
          className={className ? `journal-date-trigger ${className}` : 'journal-date-trigger'}
          disabled={disabled}
          type="button"
          variant="outline"
        >
          {displayValue ?? value}
          <CaretDown size={13} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="journal-calendar" sideOffset={8}>
        <div className="journal-calendar-header">
          <button type="button" aria-label="上个月" onClick={() => changeMonth(-1)}>
            <CaretLeft size={18} />
          </button>
          <strong>{formatMonthTitle(displayMonth.year, displayMonth.month)}</strong>
          <button type="button" aria-label="下个月" onClick={() => changeMonth(1)}>
            <CaretRight size={18} />
          </button>
        </div>
        <div className="journal-calendar-weekdays">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="journal-calendar-grid">
          {calendarDays.map((day) => {
            const dayDisabled = isDateDisabled(day.stamp)
            return (
              <DropdownMenuItem
                className={[
                  'journal-calendar-day',
                  day.currentMonth ? '' : 'outside',
                  entryDates.has(day.stamp) ? 'has-entry' : '',
                  day.stamp === value ? 'selected' : '',
                  dayDisabled ? 'disabled' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={dayDisabled}
                key={day.stamp}
                onSelect={() => onChange(day.stamp)}
              >
                {day.day}
              </DropdownMenuItem>
            )
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
