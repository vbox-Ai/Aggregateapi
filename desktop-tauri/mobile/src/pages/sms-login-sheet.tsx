import { useEffect, useRef, useState } from 'react'
import { Button, Card, Input, Label, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@ui'
import { copyWithToast } from '../components/ui'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import {
  SMS_CODE_RE, SMS_PROFILES, SMS_RESEND_COOLDOWN_SECONDS, sendSmsCode, smsProfileOf, verifySmsLogin,
  type SmsProfile,
} from '../api/sms-login'
import { t } from '../i18n'

/**
 * 手机验证码登录（AutoClaw 国内版 / Loomy / Tabbit 国内站）。
 *
 * ── 为什么手机端也要有这条路 ──────────────────────────────────
 * AutoClaw 国内版与 Loomy 的账号体系**没有网页授权码**：官方客户端唯一的自助
 * 入口就是手机号 + 验证码。手机端此前只有「网页登录」与「粘贴凭证」，这两家
 * 就都加不进来 —— 而它们恰好是国内用户最常用的。
 *
 * ── 与桌面端一致的行为（逐条对齐 `ui/sms-login.js`）────────────
 *  1. **发码与登录共用一把锁**：两颗按钮都打上游，不能并点；
 *  2. **冷却 60 秒**，且**成功与失败都进冷却**（「过于频繁」那种失败正是最该
 *     冷却的一种，官方桌面端也把 60 写死在客户端里）；
 *  3. **改手机号 = 换了一轮登录**：清掉中间态与风控会话，否则新号会带着旧号
 *     那次验证的结论去发码；
 *  4. 验证码 6 位、手机号按家给正则（Loomy 只收 `1[3-9]`），先在界面上挡一次。
 *
 * ── 手机端与桌面端的两处**有意不同** ──────────────────────────
 *  · **KukuAI 没有这条入口**：它的发码必须在官方页面里点（风控签名只有页面能
 *    生成），桌面端是壳开隐藏窗口自动填号发码、再读 HttpOnly Cookie 交回。
 *    手机 App 没有这套壳能力，硬做只会得到一条点不通的路。
 *  · **Tabbit 的滑块验证页不自动打开**：App 的 WebView 不支持 `window.open`
 *    （见 `lib/community.ts` 的说明，Capacitor 会直接忽略），同窗跳转又会把
 *    面板顶掉、回来还得手动导航。所以这里给「复制验证页地址」让人用浏览器打开，
 *    滑完回来点「已完成验证，继续发送」—— 与桌面端打不开窗口时的兜底同一形态。
 */
export function SmsLoginSheet({ providers, onClose, onAdded, initialProvider = '' }: {
  providers: Array<{ id?: string; label?: string }>
  onClose: () => void
  onAdded: () => void
  initialProvider?: string
}) {
  // 只列三家支持的渠道；账号目录里已有的家才算（避免给一个装不了的选项）
  const available = SMS_PROFILES.filter(profile =>
    !providers.length || providers.some(item => item.id === profile.provider))
  const [provider, setProvider] = useState(initialProvider || available[0]?.provider || SMS_PROFILES[0].provider)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [hint, setHint] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [captchaUrl, setCaptchaUrl] = useState('')
  const identity = serverIdentity()

  const profile: SmsProfile = smsProfileOf(provider)
  /** 最近一次发码的中间态（deviceId / msgid / uuid） */
  const ticketRef = useRef('')
  /** 被风控拦下那一轮给的 uuid；过完滑块重发要沿用它 */
  const captchaTicketRef = useRef('')
  /** 验证页已给用户、正等他回来说「继续发送」 */
  const captchaPendingRef = useRef(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  const resetCaptchaRound = () => {
    captchaPendingRef.current = false
    captchaTicketRef.current = ''
    ticketRef.current = ''
    setCaptchaUrl('')
    setHint('')
  }

  /** 改手机号 = 换一轮登录：风控会话与「已过验证」全都作废 */
  const onPhoneChange = (value: string) => {
    setPhone(value)
    if (captchaPendingRef.current || captchaTicketRef.current) resetCaptchaRound()
  }

  const send = async () => {
    if (busy) return
    const resuming = captchaPendingRef.current
    if (!resuming && cooldown > 0) return
    const number = phone.trim()
    if (!profile.phoneRe.test(number)) {
      store.toast(t('请填写 11 位大陆手机号'), 'err')
      return
    }
    setBusy('send')
    setError('')
    captchaPendingRef.current = false
    try {
      const outcome = await sendSmsCode(profile, number, captchaTicketRef.current)
      if (serverIdentity() !== identity) return
      if (outcome.kind === 'captcha') {
        captchaTicketRef.current = outcome.ticket
        if (outcome.ticket) ticketRef.current = outcome.ticket
        captchaPendingRef.current = true
        setCaptchaUrl(outcome.verifyUrl)
        setHint(outcome.verifyUrl
          ? t('{message}：请在浏览器打开验证页完成滑块，完成后回到这里点「已完成验证，继续发送」', { message: outcome.message })
          : t('上游要求人机验证，但没有给出验证页面地址，请稍后重试'))
        // 这一步不打冷却：按钮马上要给用户点，倒计时会让人以为还得等 60 秒
        return
      }
      captchaTicketRef.current = ''
      ticketRef.current = outcome.ticket
      setHint(t('验证码已发送。收到后填入下方并点「登录并添加」'))
      store.toast(t('验证码已发送，请查看短信'))
      setCooldown(SMS_RESEND_COOLDOWN_SECONDS)
    } catch (failure) {
      if (serverIdentity() !== identity) return
      const reason = failure instanceof Error ? failure.message : String(failure)
      setError(t('发送失败：{message}', { message: reason }))
      // 失败也进冷却：见 api/sms-login.ts 里 SMS_RESEND_COOLDOWN_SECONDS 的说明
      setCooldown(SMS_RESEND_COOLDOWN_SECONDS)
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const submit = async () => {
    if (busy) return
    const number = phone.trim()
    const value = code.trim()
    if (!profile.phoneRe.test(number)) {
      store.toast(t('请填写 11 位大陆手机号'), 'err')
      return
    }
    if (!SMS_CODE_RE.test(value)) {
      store.toast(t('请填写 6 位数字验证码'), 'err')
      return
    }
    setBusy('verify')
    setError('')
    try {
      const result = await verifySmsLogin(profile, {
        phone: number, code: value, ticket: ticketRef.current, name,
      })
      if (serverIdentity() !== identity) return
      if (!result?.account?.id) throw new Error(t('登录未返回已完成的账号，请重试'))
      store.toast(t('账号已添加'))
      onAdded()
    } catch (failure) {
      if (serverIdentity() !== identity) return
      const reason = failure instanceof Error ? failure.message : String(failure)
      setError(t('登录失败：{message}', { message: reason }))
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const sendLabel = busy === 'send'
    ? t('发送中…')
    : captchaPendingRef.current
      ? t('已完成验证，继续发送')
      : cooldown > 0
        ? t('{seconds}s 后重发', { seconds: cooldown })
        : t('获取验证码')

  return (
    <Sheet open onOpenChange={(open, details) => {
      if (open) return
      if (busy) { details.cancel(); return }
      onClose()
    }}>
      <SheetContent showCloseButton={!busy}>
        <SheetHeader>
          <SheetTitle>{t('手机验证码登录')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8 }}>
            <p style={{ fontSize: 12.5, lineHeight: 1.7, color: 'var(--m-text-2)' }}>
              {t('这两家没有网页授权：填手机号收验证码即可直接把账号加进来，与桌面端的「手机验证码登录」是同一条链路。')}
            </p>

            <div>
              <Label>{t('提供商')}</Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                {(available.length ? available : SMS_PROFILES).map(item => (
                  <Button key={item.provider} size='sm' type='button'
                    variant={item.provider === provider ? 'default' : 'outline'}
                    disabled={Boolean(busy)}
                    onClick={() => {
                      if (item.provider === provider) return
                      setProvider(item.provider)
                      resetCaptchaRound()
                    }}>
                    {item.label}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor='sms-phone'>{t('手机号')}</Label>
              <Input id='sms-phone' inputMode='numeric' autoComplete='tel' placeholder={t('11 位大陆手机号')}
                value={phone} disabled={Boolean(busy)} onChange={event => onPhoneChange(event.target.value)} />
            </div>

            <div>
              <Label htmlFor='sms-code'>{t('验证码')}</Label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                <Input id='sms-code' inputMode='numeric' autoComplete='one-time-code' placeholder={t('6 位数字')}
                  value={code} disabled={Boolean(busy)} onChange={event => setCode(event.target.value)} />
                <Button variant='outline' size='sm' type='button'
                  disabled={Boolean(busy) || (!captchaPendingRef.current && cooldown > 0)}
                  onClick={() => void send()}>
                  {sendLabel}
                </Button>
              </div>
            </div>

            {captchaUrl ? (
              <Card className='m-card m-card-pad'>
                <div style={{ fontSize: 12.5, lineHeight: 1.7, color: 'var(--m-text-2)' }}>
                  {t('验证页地址（App 里的浏览器控件不支持新开窗口，请复制到浏览器打开）：')}
                </div>
                <code style={{ display: 'block', marginTop: 6, wordBreak: 'break-all', fontSize: 11.5 }}>{captchaUrl}</code>
                <div style={{ marginTop: 8 }}>
                  <Button variant='outline' size='sm' type='button'
                    onClick={() => void copyWithToast(captchaUrl, t('验证页地址'))}>
                    {t('复制验证页地址')}
                  </Button>
                </div>
              </Card>
            ) : null}

            {hint && !error ? (
              <p style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--m-text-2)' }}>{hint}</p>
            ) : null}

            <div>
              <Label htmlFor='sms-name'>{t('备注名（可选）')}</Label>
              <Input id='sms-name' placeholder={t('例如：主力号')} value={name}
                disabled={Boolean(busy)} onChange={event => setName(event.target.value)} />
            </div>

            {error ? <p style={{ fontSize: 12, color: 'var(--m-danger)', whiteSpace: 'pre-wrap' }}>{error}</p> : null}
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' disabled={Boolean(busy)} onClick={onClose}>{t('取消')}</Button>
          <Button disabled={Boolean(busy)} onClick={() => void submit()}>
            {busy === 'verify' ? t('登录中…') : t('登录并添加')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
