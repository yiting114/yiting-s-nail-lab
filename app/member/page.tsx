'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

interface OrderItem {
  id: string;
  service_name: string;
  order_date: string;
  amount?: number;
  status: string;
}

interface Coupon {
  id: string;
  code: string;
  discount_amount?: number;
  discount_percent?: number;
  description?: string;
}

export default function MemberPage() {
  const router = useRouter();
  const [authChecking, setAuthChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [points, setPoints] = useState<number>(0);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  // 🆕 1. 推薦碼與優惠碼 State
  const [inputCouponCode, setInputCouponCode] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [copied, setCopied] = useState(false);
  // 🆕 彈窗控制 State
const [showBindModal, setShowBindModal] = useState(false);
const [bindPhone, setBindPhone] = useState('');
const [refCodeInput, setRefCodeInput] = useState('');
const [submittingBind, setSubmittingBind] = useState(false);

  // 複製推薦碼
  const handleCopyReferral = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    // 監聽登入狀態
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!session) {
        router.push('/login');
      } else {
        setUser(session.user);
        setAuthChecking(false);
        await loadAllMemberData(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  const loadAllMemberData = async (userId: string) => {
    setLoading(true);

    try {
      // 1. 抓取會員 Profile 與點數
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (profileData) {
        setProfile(profileData);
        setPoints(profileData.points || 0);
        // 🆕 補在這裡：如果沒有手機號碼，自動彈出綁定視窗
    if (!profileData.phone) {
      setShowBindModal(true);
    }
      }

      // 2. 抓取優惠券 (coupons)
      const { data: couponData } = await supabase
        .from('coupons')
        .select('*');

      if (couponData) {
        setCoupons(couponData);
      }

// 3. 抓取預約/訂單紀錄 (直接抓取 orders 表格裡現成的資料)
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', userId);

      if (orderError) {
        console.error('抓取訂單失敗:', orderError.message);
      }

      if (orderData) {
        const formattedOrders = orderData.map((item: any) => ({
          id: item.id,
          service_name: item.service_name || '美甲服務',
          order_date: item.created_at ? new Date(item.created_at).toLocaleDateString() : '最新預約',
          amount: item.amount || 0,
          status: item.status || 'confirmed',
        }));
        setOrders(formattedOrders);
      }
      
      if (orderError) {
        console.error('抓取訂單失敗:', orderError.message);
      }

      if (orderData) {
        const formattedOrders = orderData.map((item: any) => ({
          id: item.id,
          service_name: item.services?.title || item.title || item.service_name || '美甲款式預約',
          order_date: item.created_at ? new Date(item.created_at).toLocaleDateString() : (item.date || '最新預約'),
          amount: item.services?.price || item.total_amount || item.amount,
          status: item.status || 'confirmed',
        }));
        setOrders(formattedOrders);
      }

    } catch (err) {
      console.error('資料載入異常:', err);
    } finally {
      setLoading(false);
    }
  };

  // 取消訂單/預約
  const handleCancelOrder = async (orderId: string) => {
    const confirmCancel = window.confirm('確定要取消這筆預約紀錄嗎？');
    if (!confirmCancel) return;

    const { error } = await supabase
      .from('orders')
      .update({ status: 'cancelled' })
      .eq('id', orderId);

    if (error) {
      alert(`取消失敗：${error.message}`);
    } else {
      alert('已成功取消！');
      if (user) loadAllMemberData(user.id);
    }
  };

  // 🆕 2. 兌換推薦碼/優惠碼函式
  const handleRedeemCode = async () => {
    if (!inputCouponCode.trim() || !user) return;
    setClaiming(true);
    const code = inputCouponCode.trim().toLowerCase();

    // A. 檢查是否為專屬推薦碼
    const { data: referrer } = await supabase
      .from('profiles')
      .select('id, referral_code')
      .eq('referral_code', code)
      .single();

    if (referrer) {
      if (referrer.id === user.id) {
        alert('不能輸入自己的推薦碼喔！');
        setClaiming(false);
        return;
      }

      const { data: myProfile } = await supabase
        .from('profiles')
        .select('used_referral_code')
        .eq('id', user.id)
        .single();

      if (myProfile?.used_referral_code) {
        alert('您已經使用過推薦碼囉！每位會員限用一次。');
        setClaiming(false);
        return;
      }

      const expireDate = new Date();
      expireDate.setDate(expireDate.getDate() + 90);

      await supabase.from('coupons').insert([
        {
          user_id: user.id,
          title: '好友推薦禮 $50 折價券',
          discount_amount: 50,
          expires_at: expireDate.toISOString(),
          is_used: false,
        },
        {
          user_id: referrer.id,
          title: '成功推薦好友獎勵 $50 折價券',
          discount_amount: 50,
          expires_at: expireDate.toISOString(),
          is_used: false,
        },
      ]);

      await supabase
        .from('profiles')
        .update({ used_referral_code: code })
        .eq('id', user.id);

      alert('🎉 推薦碼兌換成功！已發放 $50 折價券（90天效期）至您與好友的帳戶！');
      setInputCouponCode('');
      setClaiming(false);
      loadAllMemberData(user.id);
      return;
    }

    // B. 通用優惠碼檢查
    const { data: couponData } = await supabase
      .from('coupons')
      .select('*')
      .eq('code', code)
      .single();

    if (couponData) {
      const expireDate = new Date();
      expireDate.setDate(expireDate.getDate() + 90);

      await supabase.from('coupons').insert({
        user_id: user.id,
        title: couponData.title || '優惠券',
        discount_amount: couponData.discount_amount || 50,
        expires_at: expireDate.toISOString(),
        is_used: false,
      });

      alert(`🎉 優惠碼兌換成功！已獲得 ${couponData.title || '折價券'}！`);
      setInputCouponCode('');
    } else {
      alert('找不到此推薦碼或優惠碼，請確認後重試。');
    }

    setClaiming(false);
    loadAllMemberData(user.id);
  };

  // 🆕 處理手機號碼綁定與推薦碼
  const handleCompleteBinding = async () => {
    if (!bindPhone.trim()) {
      alert('請輸入手機號碼！');
      return;
    }

    const phoneRegex = /^09\d{8}$/;
    if (!phoneRegex.test(bindPhone.trim())) {
      alert('請輸入正確的手機號碼格式 (如: 0912345678)');
      return;
    }

    setSubmittingBind(true);

    try {
      // 檢查號碼是否已被其他人綁定
      const { data: existingPhone } = await supabase
  .from('profiles')
  .select('id')
  .eq('phone', bindPhone.trim())
  .maybeSingle();

      if (existingPhone && existingPhone.id !== user?.id) {
  alert('此手機號碼已經被綁定過了！\n\n如果您上次是使用 Google 或 LINE 登入，請點擊下方「登出並切換帳號」改用之前的登入方式喔！');
  setSubmittingBind(false);
  return;
}

      // 更新手機號碼
      const { error: updatePhoneError } = await supabase
        .from('profiles')
        .update({ phone: bindPhone.trim() })
        .eq('id', user?.id);

      if (updatePhoneError) throw updatePhoneError;

      // 如果有填寫推薦碼
      if (refCodeInput.trim()) {
        const code = refCodeInput.trim().toLowerCase();

        const { data: referrer } = await supabase
          .from('profiles')
          .select('id')
          .eq('referral_code', code)
          .single();

        if (referrer && referrer.id !== user?.id) {
          const expireDate = new Date();
          expireDate.setDate(expireDate.getDate() + 90);

          await supabase.from('coupons').insert([
            {
              user_id: user?.id,
              title: '好友推薦禮 $50 折價券',
              discount_amount: 50,
              expires_at: expireDate.toISOString(),
              is_used: false,
            },
            {
              user_id: referrer.id,
              title: '成功推薦好友獎勵 $50 折價券',
              discount_amount: 50,
              expires_at: expireDate.toISOString(),
              is_used: false,
            },
          ]);

          await supabase
            .from('profiles')
            .update({ used_referral_code: code })
            .eq('id', user?.id);

          alert('🎉 手機綁定成功！已為您與好友發放 $50 優惠券（90天效期）！');
        } else {
          alert('手機綁定成功！(推薦碼無效或屬於自己，故未發放推薦禮)');
        }
      } else {
        alert('🎉 手機號碼綁定成功！');
      }

      setShowBindModal(false);
      loadAllMemberData(user?.id);
    } catch (error: any) {
      alert(`綁定失敗：${error.message}`);
    } finally {
      setSubmittingBind(false);
    }
  };

  // 登出
  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-rose-50/30">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-rose-500"></div>
        <p className="text-sm font-medium text-gray-500 ml-3">確認會員身份中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-rose-50/20 pb-12">
      
      {/* 頂部導覽列 */}
      <header className="bg-white border-b border-rose-100 sticky top-0 z-10 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-rose-600 font-bold text-lg hover:opacity-80 transition">
            <span>💅 美甲預約系統</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="px-3 py-1.5 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
            >
              🏠 回到首頁
            </Link>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition"
            >
              登出
            </button>
          </div>
        </div>
      </header>

      {/* 主要內容區 */}
      <main className="max-w-3xl mx-auto p-4 md:p-8 space-y-6">
        
        {/* 1. 會員個人資料卡片 */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-rose-100 flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-bold text-rose-500 bg-rose-50 px-2.5 py-0.5 rounded-full">VIP 會員</span>
            <h1 className="text-xl font-bold text-gray-800 mt-1">
              {profile?.full_name || profile?.name || user?.user_metadata?.full_name || user?.email || '親愛的會員'}
            </h1>
            <p className="text-xs text-gray-400 font-mono">
              帳號 ID: {user?.id}
            </p>
          </div>
        </div>

        {/* 🎁 專屬推薦碼與優惠碼兌換區塊 */}
<div className="bg-white rounded-2xl p-6 shadow-sm border border-rose-100 space-y-4">
  {/* 專屬推薦碼展示 */}
  <div className="flex flex-wrap items-center justify-between gap-3 bg-rose-50/60 p-4 rounded-xl border border-rose-100">
    <div>
      <p className="text-xs font-bold text-rose-500">🎁 您的專屬推薦碼</p>
      <p className="text-xs text-gray-500">分享給好友，雙方皆可獲得 $50 優惠券 (90天效期)</p>
    </div>
    <div className="flex items-center gap-2">
      <span className="font-mono font-bold text-rose-600 bg-white px-3 py-1.5 rounded-lg border border-rose-200 text-sm">
        {(profile as any)?.referral_code || '載入中...'}
      </span>
      <button
        onClick={() => handleCopyReferral((profile as any)?.referral_code || '')}
        className="px-3 py-1.5 bg-rose-500 hover:bg-rose-600 text-white rounded-lg text-xs font-bold transition"
      >
        {copied ? '✓ 已複製' : '複製'}
      </button>
    </div>
  </div>

  {/* 輸入優惠碼 / 推薦碼 */}
  <div className="pt-2">
    <label className="block text-xs font-bold text-gray-700 mb-1">🎟️ 輸入優惠碼 / 好友推薦碼</label>
    <div className="flex gap-2">
      <input
        type="text"
        placeholder="請輸入 6 位數推薦碼或優惠碼"
        value={inputCouponCode}
        onChange={(e) => setInputCouponCode(e.target.value)}
        className="flex-1 p-2.5 text-xs border border-gray-200 rounded-xl focus:outline-none focus:border-rose-400 font-mono"
      />
      <button
        onClick={handleRedeemCode}
        disabled={claiming}
        className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl transition disabled:opacity-50"
      >
        {claiming ? '兌換中...' : '兌換'}
      </button>
    </div>
  </div>
</div>

        {/* 3. 我的優惠券區塊 */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-rose-100 space-y-4">
          <h2 className="text-lg font-bold text-gray-800">🎟️ 可用優惠券</h2>
          {coupons.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">目前沒有可用的優惠券</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {coupons.map((coupon) => (
                <div key={coupon.id} className="p-3.5 border border-dashed border-rose-300 bg-rose-50/40 rounded-xl flex justify-between items-center">
                  <div>
                    <p className="font-bold text-rose-600 text-sm">{coupon.code || '優惠折扣券'}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{coupon.description || '專屬折扣優惠'}</p>
                  </div>
                  <span className="text-xs font-bold bg-rose-500 text-white px-2.5 py-1 rounded-lg">
                    {coupon.discount_amount ? `$${coupon.discount_amount} 折扣` : '優惠中'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 4. 預約/訂單紀錄區塊 */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-rose-100 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-800">📅 我的預約紀錄</h2>
            <Link href="/" className="text-xs font-bold text-rose-500 hover:underline">
              + 新增預約
            </Link>
          </div>

          {loading ? (
            <p className="text-sm text-gray-400 text-center py-6">載入預約紀錄中...</p>
          ) : orders.length === 0 ? (
            <div className="text-center py-8 space-y-3">
              <p className="text-sm text-gray-400">目前尚無預約紀錄</p>
              <Link
                href="/"
                className="inline-block px-4 py-2 bg-rose-500 text-white text-xs font-bold rounded-xl shadow-md hover:bg-rose-600 transition"
              >
                立即挑選美甲款式
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-4 rounded-xl border border-gray-100 bg-gray-50/50"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-800 text-sm">{item.service_name}</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                          item.status === 'cancelled'
                            ? 'bg-gray-200 text-gray-500'
                            : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {item.status === 'cancelled' ? '已取消' : '預約成功'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">
                      📅 日期：{item.order_date} {item.amount ? `| 金額：$${item.amount}` : ''}
                    </p>
                  </div>

                  {item.status !== 'cancelled' && (
                    <button
                      onClick={() => handleCancelOrder(item.id)}
                      className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-semibold rounded-lg transition border border-rose-200"
                    >
                      取消預約
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

      </main>
      {/* 📱 新用戶綁定手機 & 推薦碼彈窗 */}
{showBindModal && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
    <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-rose-100 space-y-5">
      <div className="text-center space-y-1">
        <div className="w-12 h-12 bg-rose-100 text-rose-500 rounded-full flex items-center justify-center text-xl mx-auto font-bold mb-2">
          📱
        </div>
        <h3 className="text-lg font-bold text-gray-800">歡迎！請先完成手機綁定</h3>
        <p className="text-xs text-gray-500">為了提供預約通知與會員優惠，請填寫您的手機號碼</p>
      </div>

      <div className="space-y-3 text-xs">
        <div>
          <label className="block font-bold text-gray-700 mb-1">
            手機號碼 <span className="text-rose-500">*必填</span>
          </label>
          <input
            type="tel"
            placeholder="例如: 0912345678"
            value={bindPhone}
            onChange={(e) => setBindPhone(e.target.value)}
            className="w-full p-3 border border-gray-200 rounded-xl focus:outline-none focus:border-rose-400 font-mono text-sm"
          />
        </div>

        <div>
          <label className="block font-bold text-gray-700 mb-1">
            好友推薦碼 <span className="text-gray-400 font-normal">(選填，可獲 $50 折價券)</span>
          </label>
          <input
            type="text"
            placeholder="請輸入好友的 6 位推薦碼"
            value={refCodeInput}
            onChange={(e) => setRefCodeInput(e.target.value)}
            className="w-full p-3 border border-gray-200 rounded-xl focus:outline-none focus:border-rose-400 font-mono text-sm"
          />
        </div>
      </div>

      <button
        onClick={handleCompleteBinding}
        disabled={submittingBind}
        className="w-full py-3 bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs rounded-xl shadow-md transition disabled:opacity-50"
      >
        {submittingBind ? '綁定中...' : '確認綁定並領取優惠'}
      </button>

      {/* 🆕 新增：登出與切換帳號按鈕 */}
<div className="text-center pt-2">
  <button
    type="button"
    onClick={handleLogout}
    className="text-xs text-gray-400 hover:text-gray-600 underline transition"
  >
    這不是您的新帳號？登出並切換登入方式
  </button>
</div>
    </div>
  </div>
)}
    </div>
  );
}