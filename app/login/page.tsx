'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function LoginPage() {
  const router = useRouter();
  const [isSignUp, setIsSignUp] = useState(false); // 切換 登入/註冊
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // 1. Google 登入
  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  // 2. LINE 登入
  const handleLineLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'custom:line' as any,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  // 3. Email 登入 / 註冊 處理
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 🔒 前端欄位格式攔截檢查
    if (!email.trim() || !email.includes('@')) {
      alert('請輸入正確的 Email 格式（例如：name@example.com）');
      return;
    }

    if (password.length < 6) {
      alert('⚠️ 密碼長度不足！請輸入至少 6 個字元的密碼。');
      return;
    }

    setLoading(true);

    try {
      if (isSignUp) {
        // --- 註冊流程 ---
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password: password,
        });

        if (error) {
          if (error.message.includes('already registered')) {
            alert('此 Email 已經註冊過囉！請直接切換至「登入」。');
          } else if (error.message.includes('at least 6 characters')) {
            alert('密碼長度至少需要 6 個字元！');
          } else {
            alert(`註冊失敗：${error.message}`);
          }
          setLoading(false);
          return;
        }

        // 確定有拿到 session 才是真正登入成功
if (data.session) {
  alert('🎉 帳號註冊成功！已為您自動登入！');
  router.push('/member');
} else {
  alert('帳號已建立！請直接切換至「登入」進行登入。');
  setIsSignUp(false); // 切換回登入畫面
}

        // 自動建立初始 Profile
        if (data.user) {
          const randomCode = Math.random().toString(36).substring(2, 8).toLowerCase();
          await supabase.from('profiles').insert([
            {
              id: data.user.id,
              email: email.trim(),
              full_name: email.split('@')[0],
              referral_code: randomCode,
              points: 0,
            },
          ]);
        }

        alert('🎉 帳號註冊成功！已為您自動登入！');
        router.push('/member');
      } else {
        // --- 登入流程 ---
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password,
        });

        if (error) {
          if (error.message.includes('Invalid login credentials')) {
            alert('帳號或密碼輸入錯誤，請確認後重試！');
          } else {
            alert(`登入失敗：${error.message}`);
          }
          setLoading(false);
          return;
        }

        router.push('/member');
      }
    } catch (err: any) {
      alert(`發生錯誤：${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-rose-50/30 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-xl border border-rose-100 space-y-6">
        {/* 標題區 */}
        <div className="text-center space-y-2">
          <div className="text-4xl">💅</div>
          <h1 className="text-2xl font-bold text-gray-800">美甲預約系統</h1>
          <p className="text-xs text-gray-500">
            {isSignUp ? '建立新帳號以進行預約' : '歡迎回來！請登入您的帳號'}
          </p>
        </div>

        {/* 快速第三方登入 */}
        <div className="space-y-2">
          /*<button
            onClick={handleLineLogin}
            className="w-full py-2.5 bg-[#06C755] hover:bg-[#05b34c] text-white font-bold text-xs rounded-xl shadow-sm transition flex items-center justify-center gap-2"
          >
            💬 LINE 快速登入 / 註冊
          </button>*/
          <button
            onClick={handleGoogleLogin}
            className="w-full py-2.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold text-xs rounded-xl shadow-sm transition flex items-center justify-center gap-2"
          >
            🌐 Google 帳號登入
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs text-gray-400">
          <div className="flex-1 h-[1px] bg-gray-200"></div>
          <span>或使用 Email {isSignUp ? '註冊' : '登入'}</span>
          <div className="flex-1 h-[1px] bg-gray-200"></div>
        </div>

        {/* 表單 */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-gray-700 mb-1">電子郵件 (Email)</label>
            <input
              type="email"
              required
              placeholder="例如: user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-3 border border-gray-200 rounded-xl focus:outline-none focus:border-rose-400"
            />
          </div>

          <div>
            <label className="block font-bold text-gray-700 mb-1">密碼 (Password)</label>
            <input
              type="password"
              required
              placeholder="請輸入密碼（至少 6 位數）"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3 border border-gray-200 rounded-xl focus:outline-none focus:border-rose-400"
            />
            {/* 🆕 提示顧客字數要求 */}
            <p className="text-[10px] text-rose-400 mt-1">💡 密碼長度需至少 6 個字元</p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs rounded-xl shadow-md transition disabled:opacity-50"
          >
            {loading ? '處理中...' : isSignUp ? '確認註冊並登入' : '登入系統'}
          </button>
        </form>

        {/* 切換 登入/註冊 */}
        <div className="text-center pt-2">
          <button
            type="button"
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-xs text-rose-500 hover:underline font-bold"
          >
            {isSignUp ? '已經有帳號了？點此登入' : '還沒有帳號？點此免費註冊'}
          </button>
        </div>
      </div>
    </div>
  );
}