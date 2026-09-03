'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface Coupon {
  id: string;
  code: string;
  discount_amount: number;
}

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  service: {
    id: string;
    name: string;
    price: number;
  };
  bookingDate: string;
  bookingTime: string;
  onSuccess: () => void;
}

export default function CheckoutModal({
  isOpen,
  onClose,
  service,
  bookingDate,
  bookingTime,
  onSuccess,
}: CheckoutModalProps) {
  const [loading, setLoading] = useState(false);
  const [userPoints, setUserPoints] = useState<number>(0);
  const [coupons, setCoupons] = useState<Coupon[]>([]);

  // 折抵與付款設定
  const [selectedCouponId, setSelectedCouponId] = useState<string>('');
  const [usedPoints, setUsedPoints] = useState<number>(0);
  
  // 收款方式：'ipass' (行動支付掃碼) 或 'bank' (銀行轉帳)
  const [payType, setPayType] = useState<'ipass' | 'bank'>('ipass');
  // 顧客填寫的對帳資訊（LINE名稱 或 轉帳後5碼）
  const [payerInfo, setPayerInfo] = useState<string>('');

  const DEPOSIT_AMOUNT = 500; // 固定訂金 500 元

  // 載入會員點數與優惠券
  useEffect(() => {
    if (!isOpen) return;

    const fetchUserRewards = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 載入點數
      const { data: profile } = await supabase
        .from('profiles')
        .select('points')
        .eq('id', user.id)
        .single();
      if (profile) setUserPoints(profile.points || 0);

      // 載入優惠券
const { data: userCoupons } = await supabase
  .from('user_coupons')
  .select(`
    id,
    is_used,
    coupons (
      id,
      code,
      discount_amount
    )
  `)
  .eq('user_id', user.id)
  .eq('is_used', false);

if (userCoupons) {
  const formatted = userCoupons
    .filter((item: any) => item.coupons)
    .map((item: any) => ({
      id: item.id, // 使用 user_coupons 表本身的 id
      code: item.coupons.code || '優惠折扣券',
      discount_amount: item.coupons.discount_amount || 0,
    }));
  setCoupons(formatted as any);
}
    };

    fetchUserRewards();
  }, [isOpen]);

  if (!isOpen) return null;

  // 計算折扣
  const selectedCoupon = coupons.find((c) => c.id === selectedCouponId);
const couponDiscount = selectedCoupon ? selectedCoupon.discount_amount : 0;
const totalDiscount = couponDiscount + usedPoints;
  const finalTotalAmount = Math.max(0, service.price - totalDiscount);
  const remainingAtStore = Math.max(0, finalTotalAmount - DEPOSIT_AMOUNT);

  // 點數輸入驗證
  const handlePointsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value) || 0;
    if (val < 0) setUsedPoints(0);
    else if (val > userPoints) setUsedPoints(userPoints);
    else if (val > service.price - couponDiscount)
      setUsedPoints(service.price - couponDiscount);
    else setUsedPoints(val);
  };

  // 最大折抵按鈕
  const handleMaxPoints = () => {
    const maxUsable = Math.min(userPoints, service.price - couponDiscount);
    setUsedPoints(Math.max(0, maxUsable));
  };

  // 驗證按鈕是否可以點擊（轉帳/付款人資訊長度需 >= 3 碼）
  const isPayerInfoValid = payerInfo.trim().length >= 3;
  const isSubmitDisabled = loading || !isPayerInfoValid;

  // 確認預約並提交
  const handleConfirmBooking = async () => {
    if (!isPayerInfoValid) return;

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert('請先登入！');
        setLoading(false);
        return;
      }

      // 1. 寫入訂單
      const paymentDetailNote = payType === 'ipass' 
        ? `iPASS/掃碼 (付款人: ${payerInfo})` 
        : `銀行轉帳 (帳號後5碼: ${payerInfo})`;

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert([
          {
            user_id: user.id,
            service_name: `[預約] ${service.name} (${bookingDate} ${bookingTime})`,
            amount: finalTotalAmount,
            deposit_amount: DEPOSIT_AMOUNT,
            remaining_amount: remainingAtStore,
            payment_method: paymentDetailNote,
            deposit_status: '待對帳',
            status: '已預約',
          },
        ])
        .select()
        .single();

      if (orderError) throw orderError;

      // 2. 扣除使用的點數
      if (usedPoints > 0) {
        await supabase
          .from('profiles')
          .update({ points: userPoints - usedPoints })
          .eq('id', user.id);
      }

      // 3. 標記優惠券已使用
      if (selectedCouponId) {
        await supabase
          .from('user_coupons')
          .update({ status: 'used' })
          .eq('user_id', user.id)
          .eq('coupon_id', selectedCouponId);
      }

      alert('預約成功！店家確認收到訂金對帳資訊後會為您完成保留。');
      onSuccess();
      onClose();
    } catch (err: any) {
      alert('預約失敗：' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* 標題欄 */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-white">
          <h3 className="text-base font-bold text-gray-800">預約結帳與支付訂金</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 font-bold text-xl"
          >
            ✕
          </button>
        </div>

        {/* 內容區塊 */}
        <div className="p-6 overflow-y-auto space-y-5 text-sm">
          {/* 預約服務摘要 */}
          <div className="bg-rose-50/50 p-4 rounded-xl border border-rose-100">
            <h4 className="font-bold text-rose-600 text-base">{service.name}</h4>
            <p className="text-xs text-gray-500 mt-1">
              預約時間：{bookingDate} {bookingTime}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              原價：${service.price}
            </p>
          </div>

          {/* 選擇折價券 */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              選擇折價券
            </label>
            <select
              value={selectedCouponId}
              onChange={(e) => setSelectedCouponId(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-400 bg-white"
            >
              <option value="">不使用折價券</option>
{coupons.map((coupon: any) => (
  <option key={coupon.id} value={coupon.id}>
    {coupon.code} (折抵 ${coupon.discount_amount})
  </option>
))}
            </select>
          </div>

          {/* 紅利點數折抵 */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-xs font-bold text-gray-700">
                紅利點數折抵
              </label>
              <span className="text-[11px] text-gray-400">
                擁有 {userPoints} 點
              </span>
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                value={usedPoints || ''}
                onChange={handlePointsChange}
                placeholder="0"
                className="flex-1 px-3 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-400"
              />
              <button
                type="button"
                onClick={handleMaxPoints}
                className="px-3 py-2 bg-rose-100 text-rose-600 text-xs font-bold rounded-xl hover:bg-rose-200 transition"
              >
                最大折抵
              </button>
            </div>
          </div>

          <hr className="border-gray-100" />

          {/* 選擇訂金支付方式 */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-2">
              選擇訂金支付方式 (訂金 $500 - 免手續費)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPayType('ipass')}
                className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1 transition ${
                  payType === 'ipass'
                    ? 'border-[#00B900] bg-green-50 text-[#00B900]'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                📱 iPASS / 街口掃碼
              </button>
              <button
                type="button"
                onClick={() => setPayType('bank')}
                className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1 transition ${
                  payType === 'bank'
                    ? 'border-rose-500 bg-rose-50 text-rose-600'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                🏦 銀行轉帳
              </button>
            </div>
          </div>

          {/* 收款詳細資訊與輸入對帳資料 */}
          <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 text-center">
            {payType === 'ipass' ? (
              <div>
                <p className="text-xs font-bold text-gray-700 mb-2">
                  請使用 LINE / 街口 掃瞄下方 QR Code 付款 $500
                </p>
                <img
                  src="/qrcode.png"
                  alt="收款 QR Code"
                  className="w-40 h-40 mx-auto rounded-lg border bg-white p-1 shadow-sm mb-2"
                />
                <p className="text-[11px] text-gray-400">
                  （若用手機操作，可截圖後開啟 LINE 掃描器選擇照片）
                </p>
              </div>
            ) : (
              <div className="text-left text-xs space-y-1.5 text-gray-700">
                <p className="font-bold text-gray-800 mb-1">🏦 銀行轉帳帳號：</p>
                <p>銀行：<span className="font-semibold">822 中國信託</span></p>
                <p>帳號：<span className="font-mono text-rose-600 font-bold">1234-5678-9012</span></p>
                <p>戶名：<span className="font-semibold">美甲工作室</span></p>
              </div>
            )}

            {/* 對帳資訊輸入框 */}
            <div className="mt-4 text-left">
              <label className="block text-xs font-bold text-gray-700 mb-1">
                {payType === 'ipass' ? '付款人 LINE 顯示名稱 / 帳號名稱 *' : '轉帳帳號後 5 碼 *'}
              </label>
              <input
                type="text"
                placeholder={payType === 'ipass' ? '例如：王小明 (LINE)' : '例如：12345'}
                value={payerInfo}
                onChange={(e) => setPayerInfo(e.target.value)}
                maxLength={20}
                className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400 bg-white"
              />
              <p className="text-[10px] text-gray-400 mt-1">
                * 填寫完畢後才能點擊預約按鈕，方便店家為您對帳。
              </p>
            </div>
          </div>

          {/* 金額統計 */}
          <div className="space-y-1.5 pt-2 text-xs">
            <div className="flex justify-between text-gray-500">
              <span>折抵後總額：</span>
              <span>${finalTotalAmount}</span>
            </div>
            <div className="flex justify-between font-bold text-rose-600">
              <span>預付訂金：</span>
              <span>${DEPOSIT_AMOUNT}</span>
            </div>
            <div className="flex justify-between font-bold text-gray-800 text-sm pt-1 border-t border-gray-200">
              <span>到店現場結清尾款：</span>
              <span>${remainingAtStore}</span>
            </div>
          </div>
        </div>

        {/* 底部按鈕 */}
        <div className="p-4 border-t border-gray-100 bg-gray-50/50 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 bg-white border border-gray-200 text-gray-600 font-bold text-xs rounded-xl hover:bg-gray-50 transition"
          >
            返回
          </button>
          <button
            type="button"
            onClick={handleConfirmBooking}
            disabled={isSubmitDisabled}
            className={`flex-1 py-3 font-bold text-xs rounded-xl shadow-md transition ${
              isSubmitDisabled
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-rose-500 hover:bg-rose-600 text-white'
            }`}
          >
            {loading
              ? '預約處理中...'
              : !isPayerInfoValid
              ? payType === 'ipass'
                ? '請填寫付款人名稱'
                : '請填寫轉帳後 5 碼'
              : '確認預約並送出對帳資訊'}
          </button>
        </div>
      </div>
    </div>
  );
}