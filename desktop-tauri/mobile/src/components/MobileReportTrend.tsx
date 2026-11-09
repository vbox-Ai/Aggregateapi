import { useMemo, useState } from 'react'
import { Card, Empty, SegmentedControl, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui'
import type { StatsSummary } from '../api/gateway'
import { formatInt, formatTokens } from '../lib/format'
import { reportSourceName } from './SourceUsageSection'
import { t } from '../i18n'

export function MobileReportTrend({ summary }: { summary: StatsSummary }) {
  const [dimension, setDimension] = useState<'models' | 'clients' | 'apiKeys'>('models')
  const [metric, setMetric] = useState<'tokens' | 'requests'>('tokens')
  const [selected, setSelected] = useState('__all__')
  const options = useMemo(() => [{ value: '__all__', label: t('全部') }, ...(summary[dimension] || []).map(row => ({
    value: dimension === 'apiKeys' ? row.filterValue || 'unknown' : row.id || row.model || '__unknown__',
    label: dimension === 'models' ? row.label || row.model || t('未知模型') : reportSourceName(row, dimension === 'apiKeys'),
  }))], [summary, dimension])
  const displayedOptions = options.some(option => option.value === selected) ? options : [{ value: selected, label: selected }, ...options]
  const trend = (summary.dailyTrend || []).map(day => ({
    date: day.date || '',
    value: selected === '__all__' ? Number(day[metric]) || 0 : (day[dimension] || []).reduce((sum, row) => {
      const id = row.id || row.model || '__unknown__'
      return sum + (id === selected ? Number(row[metric]) || 0 : 0)
    }, 0),
  }))
  const max = Math.max(...trend.map(row => row.value), 1)
  const width = 300
  const height = 84
  const gap = trend.length > 100 ? 0 : 2
  // 只有一天（或很少几天）数据时，原来的柱宽会占满整个绘图区：一根满宽 + 满高 + 不透明的
  // 柱子看起来就是「一整块纯色」（真机反馈的"全是蓝色"）。所以给柱宽加上限，并把整组柱子
  // **居中** —— 数据少时是中间一根细柱，数据多时仍是原来的密集柱形。
  const slot = (width - gap * (trend.length - 1)) / Math.max(1, trend.length)
  const barWidth = Math.max(0.1, Math.min(slot, 28))
  const barsOffset = Math.max(0, (width - (barWidth * trend.length + gap * (trend.length - 1))) / 2)
  return <div className='m-section'><Card className='m-card p-3'>
    <b className='text-sm'>{metric === 'tokens' ? t('按天 Token 趋势') : t('按天请求趋势')}</b>
    <div className='flex flex-wrap gap-2 my-3'>
      <SegmentedControl value={dimension} aria-label={t('趋势统计维度')} onValueChange={value => {
        setDimension(value as typeof dimension); setSelected('__all__')
      }} options={[{ value: 'models', label: t('模型') }, { value: 'clients', label: t('客户端') }, { value: 'apiKeys', label: t('API Key') }]} />
      <SegmentedControl value={metric} aria-label={t('趋势统计指标')} onValueChange={value => setMetric(value as typeof metric)}
        options={[{ value: 'tokens', label: t('Token 用量') }, { value: 'requests', label: t('请求数') }]} />
      <Select value={selected} onValueChange={value => setSelected(String(value))}>
        <SelectTrigger className='w-full'><SelectValue>{displayedOptions.find(row => row.value === selected)?.label || t('全部')}</SelectValue></SelectTrigger>
        <SelectContent>{displayedOptions.map(row => <SelectItem value={row.value} key={row.value}>{row.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    {!trend.length ? <Empty>{t('暂无趋势数据')}</Empty> : (
      <><svg viewBox={`0 0 ${width} ${height}`} width='100%' height={height} role='img'
        aria-label={metric === 'tokens' ? t('按天 Token 趋势') : t('按天请求趋势')}>
        {trend.map((row, index) => {
          const size = row.value / max * height
          return <rect key={row.date} x={barsOffset + index * (barWidth + gap)} y={height - size} width={barWidth} height={size}
            rx={Math.min(3, barWidth / 2)} fill='var(--m-primary)' opacity={row.value === max ? 1 : 0.4}>
            <title>{row.date} · {metric === 'tokens' ? formatTokens(row.value) : formatInt(row.value)}</title>
          </rect>
        })}
      </svg><div className='flex justify-between text-xs text-muted-foreground mt-2'>
        <span>{trend[0]?.date}</span><span>{trend[trend.length - 1]?.date}</span>
      </div></>
    )}
  </Card></div>
}
