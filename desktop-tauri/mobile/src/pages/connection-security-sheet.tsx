import { useCallback, useEffect, useState } from 'react'
import { Alert, AlertDescription, Button, Card, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle, Switch } from '@ui'
import { Badge, Empty, ErrorNote } from '../components/ui'
import { Icon } from '../components/Icon'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import { t } from '../i18n'
import { captchaSwitchFor, fetchCaptcha, fetchCors, putCaptcha, putCors, type CaptchaSettings } from '../api/security'

/**
 * 连接与安全。
 *
 * 两个开关的**作用面完全不同**，界面上分开写清：
 *  · CORS 只管网关面 `/v1/*`（谁能从浏览器跨来源调你的网关）；
 *  · 人机验证只管**面板登录 / 注册**，与 `/v1/*` 的 Key 鉴权无关。
 *
 * 两个开关都是「点一下立即生效」：它们本身就是安全开关，多一步保存反而容易
 * 让人以为已经改了。
 */
export function ConnectionSecuritySheet({ onClose }: { onClose: () => void }) {
  const identity = serverIdentity()
  const [cors, setCors] = useState<boolean | null>(null)
  const [captcha, setCaptcha] = useState<CaptchaSettings | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      const [nextCors, nextCaptcha] = await Promise.all([fetchCors(), fetchCaptcha()])
      if (serverIdentity() !== identity) return
      setCors(nextCors.corsEnabled === true)
      setCaptcha(nextCaptcha)
      setError('')
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [identity])

  useEffect(() => {
    void load()
  }, [load])

  const toggleCors = async (next: boolean) => {
    if (busy) return
    const previous = cors
    setCors(next)
    setBusy('cors')
    setError('')
    try {
      const saved = await putCors(next)
      if (serverIdentity() !== identity) return
      setCors(saved.corsEnabled === true)
      store.toast(next ? t('已允许跨来源调用网关') : t('已关闭跨来源调用'))
    } catch (cause) {
      if (serverIdentity() === identity) {
        setCors(previous)
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const toggleCaptcha = async (which: 'captchaDesktop' | 'captchaWeb', next: boolean) => {
    if (busy || !captcha) return
    const previous = captcha
    setCaptcha({ ...captcha, [which]: next })
    setBusy(which)
    setError('')
    try {
      const saved = await putCaptcha({ [which]: next })
      if (serverIdentity() !== identity) return
      setCaptcha(saved)
      store.toast(t('已保存'))
    } catch (cause) {
      if (serverIdentity() === identity) {
        setCaptcha(previous)
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const own = captcha ? captchaSwitchFor(captcha) : 'captchaWeb'
  const loading = cors === null || captcha === null

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('连接与安全')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {error ? <ErrorNote text={error} /> : null}
          {loading ? <Card className='m-card'><Empty text={t('正在读取安全设置…')} /></Card> : null}

          {!loading ? (
            <>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--m-text-3)', padding: '2px 2px 6px' }}>
                {t('网关接口')}
              </div>
              <Card className='m-card'>
                <div className='m-row' style={{ alignItems: 'flex-start' }}>
                  <span className='m-logo'>
                    <Icon name='globe' />
                  </span>
                  <div className='m-grow'>
                    <div className='m-t1'>{t('允许浏览器跨来源调用网关')}</div>
                    <div className='m-t2'>{t('影响 /v1/*：开着才允许网页直接调你的网关')}</div>
                  </div>
                  <Switch
                    checked={cors === true}
                    aria-label={t('允许浏览器跨来源调用网关')}
                    onCheckedChange={value => void toggleCors(value === true)}
                  />
                </div>
              </Card>
              <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, padding: '6px 2px 0' }}>
                {t('关闭时（默认）浏览器发来的预检会被拒绝；面板自己的接口不受这个开关影响。开启会让任意网页尝试调用你的网关，请配合网关 Key 使用。')}
              </p>

              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--m-text-3)', padding: '14px 2px 6px' }}>
                {t('面板登录校验')}
              </div>
              <Card className='m-card'>
                <div className='m-row'>
                  <span className='m-logo'>
                    <Icon name='shield' />
                  </span>
                  <div className='m-grow'>
                    <div className='m-t1'>{t('本机应用登录需要人机验证')}</div>
                    <div className='m-t2'>
                      {own === 'captchaDesktop' ? t('影响你现在用的这一端') : t('桌面端登录')}
                    </div>
                  </div>
                  <Switch
                    checked={captcha?.captchaDesktop !== false}
                    aria-label={t('本机应用登录需要人机验证')}
                    onCheckedChange={value => void toggleCaptcha('captchaDesktop', value === true)}
                  />
                </div>
                <div className='m-row'>
                  <span className='m-logo'>
                    <Icon name='globe' />
                  </span>
                  <div className='m-grow'>
                    <div className='m-t1'>{t('网页端登录需要人机验证')}</div>
                    <div className='m-t2'>
                      {own === 'captchaWeb' ? t('影响你现在用的这一端') : t('浏览器 / Docker 面板')}
                    </div>
                  </div>
                  <Switch
                    checked={captcha?.captchaWeb !== false}
                    aria-label={t('网页端登录需要人机验证')}
                    onCheckedChange={value => void toggleCaptcha('captchaWeb', value === true)}
                  />
                </div>
              </Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 2px 0' }}>
                <Badge tone='mute'>
                  {captcha?.localPanel === true ? t('本机形态：桌面壳') : t('本机形态：网页 / 服务')}
                </Badge>
                <span style={{ fontSize: 11.5, color: 'var(--m-text-3)' }}>
                  {t('你现在这一端读的是「{name}」', {
                    name: own === 'captchaDesktop' ? t('本机应用登录') : t('网页端登录'),
                  })}
                </span>
              </div>
              <Alert variant='warning'>
                <AlertDescription>
                  {t('人机验证只保护面板登录与注册，和 /v1/* 的网关 Key 鉴权无关。关掉它不会放宽接口调用权限。')}
                </AlertDescription>
              </Alert>
            </>
          ) : null}
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' onClick={onClose}>{t('关闭')}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
