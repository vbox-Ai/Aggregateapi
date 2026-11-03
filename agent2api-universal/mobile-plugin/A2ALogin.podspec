Pod::Spec.new do |s|
  s.name             = 'A2ALogin'
  s.version          = '0.1.0'
  s.summary          = 'Agent2API 隔离登录容器（nonPersistent WKWebView）'
  s.description      = <<-DESC
Agent2API 的一次性 cookie 罐登录容器：每次登录开独立的 WKWebsiteDataStore.nonPersistent()，
关闭时焚毁 cookie/localStorage/缓存，并把 loopback 与自定义协议回调闭环回网关。
对应 Android 模块自带的 Agent2Login.apk。
                       DESC
  s.homepage         = 'https://github.com/aimod-cc/agent2api'
  s.license          = { :type => 'MIT' }
  s.author           = { 'agent2api' => 'noreply@example.invalid' }
  s.source           = { :path => '.' }
  s.source_files     = 'ios/Sources/**/*.{swift,h,m}'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  s.swift_version    = '5.9'
end
