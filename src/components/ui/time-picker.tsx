import * as React from 'react'
import { Clock } from '@phosphor-icons/react'

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

const HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'))
const MINUTES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'))
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

type TimePickerProps = Omit<React.ComponentProps<'div'>, 'onChange'> & {
  disabled?: boolean
  onValueChange: (value: string) => void
  value: string
}

function TimePicker({
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  'aria-label': ariaLabel = '选择时间',
  className,
  disabled = false,
  id,
  onValueChange,
  value,
  ...props
}: TimePickerProps) {
  const match = TIME_PATTERN.exec(value)
  const hour = match?.[1] ?? '00'
  const minute = match?.[2] ?? '00'

  return (
    <div
      {...props}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      aria-label={ariaLabel}
      className={cn(
        'border-input bg-background focus-within:ring-ring flex h-9 w-full items-center rounded-lg border shadow-xs transition-[color,box-shadow] focus-within:ring-1 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      data-disabled={disabled ? 'true' : undefined}
      data-slot="time-picker"
      id={id ? `${id}-group` : undefined}
      role="group"
    >
      <Select
        disabled={disabled}
        value={hour}
        onValueChange={(nextHour) => onValueChange(`${nextHour}:${minute}`)}
      >
        <SelectTrigger
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          aria-label={`${ariaLabel}，小时`}
          className="h-full min-w-0 flex-1 justify-center gap-1 rounded-r-none border-0 bg-transparent px-2 py-0 font-mono text-base tabular-nums shadow-none focus-visible:ring-0 disabled:opacity-100 [&>svg]:size-3"
          id={id}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-64 min-w-20 [&_[data-slot=select-viewport]]:!h-auto">
          <SelectGroup>
            <SelectLabel>小时</SelectLabel>
            {HOURS.map((option) => (
              <SelectItem className="font-mono tabular-nums" key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <span aria-hidden="true" className="text-muted-foreground font-mono text-base">
        :
      </span>

      <Select
        disabled={disabled}
        value={minute}
        onValueChange={(nextMinute) => onValueChange(`${hour}:${nextMinute}`)}
      >
        <SelectTrigger
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          aria-label={`${ariaLabel}，分钟`}
          className="h-full min-w-0 flex-1 justify-center gap-1 rounded-l-none border-0 bg-transparent px-2 py-0 font-mono text-base tabular-nums shadow-none focus-visible:ring-0 disabled:opacity-100 [&>svg]:size-3"
          id={id ? `${id}-minute` : undefined}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-64 min-w-20 [&_[data-slot=select-viewport]]:!h-auto">
          <SelectGroup>
            <SelectLabel>分钟</SelectLabel>
            {MINUTES.map((option) => (
              <SelectItem className="font-mono tabular-nums" key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <Clock aria-hidden="true" className="text-muted-foreground mr-2 size-4 shrink-0" />
    </div>
  )
}

export { TimePicker }
