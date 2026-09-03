'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        console.log('🔄 開始驗證 Supabase OAuth 回傳資料...');

        // 1. 監聽狀態改變，或直接取得目前 session
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          console.error('❌ 取得 Session 失敗:', error);
          alert(`登入驗證失敗: ${error.message}`);
          router.push('/login');
          return;
        }

        if (session?.user) {
          console.log('✅ 驗證成功，使用者 ID:', session.user.id);
          const user = session.user;

          // 2. 檢查 profiles 是否已建立資料
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .maybeSingle();

          if (profileError) {
            console.error('❌ 查詢 Profile 失敗:', profileError);
          }

          // 如果是第一次登入的用戶，自動建立 Profile 資料並產生推薦碼
          if (!profile) {
            console.log('🆕 新使用者，正在建立 Profile...');
            const randomCode = Math.random().toString(36).substring(2, 8).toLowerCase();
            
            const { error: insertError } = await supabase.from('profiles').insert([
              {
                id: user.id,
                email: user.email || '',
                full_name: user.user_metadata?.full_name || user.user_metadata?.name || 'LINE 用戶',
                avatar_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || '',
                referral_code: randomCode,
                points: 0,
              },
            ]);

            if (insertError) {
              console.error('❌ 建立 Profile 失敗:', insertError);
            }
          }

         // 3. 驗證完成，強制跳轉到會員中心 (或預約頁)
console.log('🚀 準備跳轉至 /member...');
window.location.href = '/member';
} else {
  console.warn('⚠️ 未找到 Session，嘗試再次檢查...');
  // 給 LINE / Supabase 緩衝 2.5 秒時間寫入 session
  setTimeout(async () => {
    const { data: { session: retrySession } } = await supabase.auth.getSession();
    if (retrySession) {
      window.location.href = '/member';
    } else {
      window.location.href = '/login';
    }
  }, 2500);
}
      } catch (err: any) {
        console.error('💥 Callback 發生異常未捕捉錯誤:', err);
        router.replace('/login');
      }
    };

    handleAuthCallback();
  }, [router]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-rose-50/30 p-4">
      <div className="w-10 h-10 border-4 border-rose-400 border-t-transparent rounded-full animate-spin mb-4"></div>
      <p className="text-gray-600 font-medium text-sm">正在驗證身份，準備進入預約頁面...</p>
    </div>
  );
}