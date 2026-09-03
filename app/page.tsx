'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import CheckoutModal from '@/components/CheckoutModal';

interface ServiceItem {
  id: string;
  title: string;
  price: number;
  duration: number;
  category: string;
  image_url?: string;
}

const generate24hTimeSlots = () => {
  const slots: string[] = [];
  for (let h = 0; h < 24; h++) {
    const hourStr = h.toString().padStart(2, '0');
    slots.push(`${hourStr}:00`);
    slots.push(`${hourStr}:30`);
  }
  return slots;
};

const TIME_SLOTS = generate24hTimeSlots();

const getMonday = (d: Date) => {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
};

const formatDateStr = (d: Date) => {
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const HAND_CONDITIONS = [
  '指甲有斷裂 / 裂痕',
  '指甲較薄 / 容易痛',
  '灰指甲 / 卷甲等特殊狀況',
];

// 輔助函式：將 "14:30" 轉為當天的總分鐘數 (例如 14*60 + 30 = 870 分鐘)
function timeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * 檢查某個 30 分鐘時段按鈕是否衝突
 * @param slotTime 按鈕的時間字串 (例如 "14:30")
 * @param serviceDuration 顧客目前選擇的服務總時長（分鐘，例如 240）
 * @param existingBookings 當天已存在的預約列表
 */
function isSlotDisabled(
  slotTime: string,
  serviceDuration: number = 120, // 預設服務時長 (可依服務彈性調整)
  existingBookings: Array<{ startTime: string; duration: number }>
): boolean {
  const currentSlotStart = timeToMinutes(slotTime);
  const currentSlotEnd = currentSlotStart + serviceDuration;

  for (const booking of existingBookings) {
    const bookedStart = timeToMinutes(booking.startTime);
    const bookedEnd = bookedStart + (booking.duration || 120);

    // 重疊條件：新時段開始時間 < 舊預約結束時間 AND 新時段結束時間 > 舊預約開始時間
    if (currentSlotStart < bookedEnd && currentSlotEnd > bookedStart) {
      return true; // 發生衝突，該按鈕必須禁用 (disabled)
    }
  }

  return false;
}

export default function Home() {
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [user, setUser] = useState<any>(null);

  const [services, setServices] = useState<ServiceItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('全部');

  const [bookingType, setBookingType] = useState<'catalog' | 'custom'>('catalog');
  const [customImageUrl, setCustomImageUrl] = useState<string>('');
  const [uploadingCustomImg, setUploadingCustomImg] = useState<boolean>(false);

  const [selectedService, setSelectedService] = useState<ServiceItem | null>(null);

  // 加購選項
  const [needExtension, setNeedExtension] = useState<boolean>(false); // 延甲: +$500, +30分
  const [needRemoval, setNeedRemoval] = useState<boolean>(false);     // 卸甲: +$0, +30分

  // 一週時段
  const [currentMonday, setCurrentMonday] = useState<Date>(getMonday(new Date()));
  const [weekDates, setWeekDates] = useState<{ dateStr: string; label: string }[]>([]);
  const [weekAvailableMap, setWeekAvailableMap] = useState<{ [key: string]: boolean }>({});
  const [loadingWeek, setLoadingWeek] = useState<boolean>(false);

  const [selectedSlot, setSelectedSlot] = useState<{ dateStr: string; timeSlot: string } | null>(null);

  const [selectedConditions, setSelectedConditions] = useState<string[]>([]);
  const [note, setNote] = useState<string>('');
  const [agreedTerms, setAgreedTerms] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [bookingSuccessData, setBookingSuccessData] = useState<any>(null);
  // 💡 1. 新增這行：用來存放資料庫的訂單
  const [orders, setOrders] = useState<any[]>([]);

useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    fetchServices();

    // 1. 讀取最新訂單
    const fetchOrders = async () => {
      const { data } = await supabase.from('orders').select('*');
      if (data) setOrders(data);
    };

    fetchOrders();

    // 2. 💡 Realtime 即時監聽
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => fetchOrders() // 訂單有變動時自動更新 orders
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'available_slots' },
        () => {
          // 💡 關鍵！直接觸發你原本的 fetchWeekAvailableSlots 函式！
          fetchWeekAvailableSlots();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentMonday]);

  const fetchServices = async () => {
    const { data } = await supabase.from('services').select('*').order('created_at', { ascending: true });
    if (data && data.length > 0) {
      setServices(data);
      const uniqueCats = Array.from(new Set(data.map((item) => item.category || '其他')));
      setCategories(uniqueCats);
      setSelectedService(data[0]);
    }
  };

  useEffect(() => {
    const days = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(currentMonday);
      d.setDate(d.getDate() + i);
      const dateStr = formatDateStr(d);
      const label = `${days[i]} (${d.getMonth() + 1}/${d.getDate()})`;
      dates.push({ dateStr, label });
    }
    setWeekDates(dates);
  }, [currentMonday]);

  // 計算總施作時間 (卸甲 +30m, 延甲 +30m)
  const calculateTotalDuration = () => {
    const baseDuration = bookingType === 'catalog' ? (selectedService?.duration || 60) : 120;
    let extra = 0;
    if (needExtension) extra += 30;
    if (needRemoval) extra += 30;
    return baseDuration + extra;
  };

  // 計算總金額 (延甲 +$500, 卸甲 +$0)
  const calculateTotalPrice = () => {
    const basePrice = bookingType === 'catalog' ? (selectedService?.price || 0) : 0;
    return needExtension ? basePrice + 500 : basePrice;
  };

  const isEnoughConsecutiveSlots = (startIndex: number, slotsNeeded: number, openTimesSet: Set<string>) => {
    for (let i = 0; i < slotsNeeded; i++) {
      const nextSlot = TIME_SLOTS[startIndex + i];
      if (!nextSlot || !openTimesSet.has(nextSlot)) {
        return false;
      }
    }
    return true;
  };

  // 判斷該時段是否已過去（過期不開放）
  const isPastSlot = (dateStr: string, timeSlot: string) => {
    const slotDateTime = new Date(`${dateStr}T${timeSlot}:00`);
    return slotDateTime < new Date();
  };

  const fetchWeekAvailableSlots = async () => {
    if (weekDates.length === 0) return;
    setLoadingWeek(true);

    const startDate = weekDates[0].dateStr;
    const endDate = weekDates[6].dateStr;

    const { data } = await supabase
      .from('available_slots')
      .select('slot_date, time_slot')
      .gte('slot_date', startDate)
      .lte('slot_date', endDate)
      .eq('is_open', true);

    const durationNeeded = calculateTotalDuration();
    const slotsNeeded = Math.ceil(durationNeeded / 30);

    const daySlotsSet: { [dateStr: string]: Set<string> } = {};
    weekDates.forEach((d) => { daySlotsSet[d.dateStr] = new Set(); });

    if (data) {
      data.forEach((item) => {
        if (daySlotsSet[item.slot_date]) {
          daySlotsSet[item.slot_date].add(item.time_slot);
        }
      });
    }

    const validMap: { [key: string]: boolean } = {};
    weekDates.forEach(({ dateStr }) => {
      const openSet = daySlotsSet[dateStr];
      TIME_SLOTS.forEach((time, index) => {
        if (!isPastSlot(dateStr, time) && isEnoughConsecutiveSlots(index, slotsNeeded, openSet)) {
          validMap[`${dateStr}_${time}`] = true;
        }
      });
    });

    setWeekAvailableMap(validMap);
    setLoadingWeek(false);
  };

  useEffect(() => {
    fetchWeekAvailableSlots();
  }, [weekDates, selectedService, bookingType, needExtension, needRemoval]);

  const changeWeek = (offsetWeeks: number) => {
    const next = new Date(currentMonday);
    next.setDate(next.getDate() + offsetWeeks * 7);
    setCurrentMonday(getMonday(next));
  };

  const handleCustomImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      if (!e.target.files || e.target.files.length === 0) return;
      const file = e.target.files[0];
      const fileExt = file.name.split('.').pop();
      const fileName = `custom_${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;

      setUploadingCustomImg(true);

      const { error: uploadError } = await supabase.storage
        .from('service-images')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('service-images')
        .getPublicUrl(fileName);

      setCustomImageUrl(urlData.publicUrl);
    } catch (err: any) {
      alert('圖片上傳失敗：' + err.message);
    } finally {
      setUploadingCustomImg(false);
    }
  };

  const handleConditionToggle = (condition: string) => {
    setSelectedConditions((prev) =>
      prev.includes(condition) ? prev.filter((item) => item !== condition) : [...prev, condition]
    );
  };

  const handleBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      alert('請先登入會員再預約！');
      return;
    }
    if (!selectedSlot) {
      alert('請點選可預約時段！');
      return;
    }
    if (!agreedTerms) {
      alert('請勾選同意店家預約須知！');
      return;
    }

    setIsCheckoutOpen(true)
  };

  const filteredServices = selectedCategory === '全部' 
    ? services 
    : services.filter((s) => s.category === selectedCategory);

  if (bookingSuccessData) {
    return (
      <div className="min-h-screen bg-rose-50/50 p-6 flex items-center justify-center font-sans">
        <div className="bg-white p-8 rounded-3xl shadow-lg max-w-md w-full border border-rose-100 text-center space-y-4">
          <div className="text-4xl">🎉</div>
          <h2 className="text-xl font-black text-slate-800">預約申請已送出！</h2>
          <p className="text-xs text-slate-500">感謝預約，請於 24 小時內完成訂金匯款以保留名額。</p>

          <div className="bg-rose-50 p-4 rounded-2xl text-left text-xs space-y-1.5 border border-rose-100">
            <p className="font-bold text-rose-800">📋 預約明細：</p>
            <p><strong>項目：</strong>{bookingSuccessData.title}</p>
            <p><strong>時間：</strong>{bookingSuccessData.date} 【{bookingSuccessData.time}】</p>
            <p><strong>預估總金額：</strong>NT$ {bookingSuccessData.price}</p>
            <p><strong>預約訂金：</strong><span className="text-rose-600 font-bold">NT$ 500</span></p>
          </div>

          <div className="bg-slate-50 p-4 rounded-2xl text-left text-xs space-y-1 border border-slate-200">
            <p className="font-bold text-slate-700">🏦 訂金匯款帳號：</p>
            <p>銀行代碼：822 (中國信託)</p>
            <p>帳號：1234-5678-9012</p>
            <p className="text-[10px] text-slate-400 mt-1">※ 匯款後請至「會員中心」回報帳號後五碼。</p>
          </div>

          <Link href="/member" className="block w-full bg-rose-500 text-white font-bold py-3 rounded-2xl text-xs">
            前往會員中心查看訂單與回報匯款
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-rose-50/50 font-sans text-slate-800">
      <nav className="bg-white/80 backdrop-blur-md border-b border-rose-100 sticky top-0 z-50 px-6 py-4 flex justify-between items-center max-w-4xl mx-auto rounded-b-2xl shadow-sm">
        <span className="text-xl font-black text-rose-500">💅 美甲線上預約</span>
        <div>
          {user ? (
            <Link href="/member" className="bg-rose-500 text-white text-xs px-4 py-2 rounded-xl font-bold">👤 會員中心</Link>
          ) : (
            <Link href="/login" className="bg-rose-500 text-white text-xs px-4 py-2 rounded-xl font-bold">登入 / 註冊</Link>
          )}
        </div>
      </nav>

      <main className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
        <form onSubmit={handleBooking} className="bg-white p-6 rounded-3xl shadow-sm border border-rose-100 space-y-6">
          <h2 className="text-lg font-bold text-slate-800 border-b border-rose-100 pb-3">✨ 步驟 1：選擇美甲款式 / 自帶圖</h2>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setBookingType('catalog')}
              className={`py-3 rounded-2xl border text-xs font-bold transition ${
                bookingType === 'catalog' ? 'border-rose-500 bg-rose-50 text-rose-600 shadow-sm' : 'border-slate-200 text-slate-500'
              }`}
            >
              💅 選擇過往款式
            </button>
            <button
              type="button"
              onClick={() => setBookingType('custom')}
              className={`py-3 rounded-2xl border text-xs font-bold transition ${
                bookingType === 'custom' ? 'border-rose-500 bg-rose-50 text-rose-600 shadow-sm' : 'border-slate-200 text-slate-500'
              }`}
            >
              📸 自帶圖 / 現場討論 (預估2小時)
            </button>
          </div>

          {bookingType === 'catalog' ? (
            <div className="space-y-3">
              <div className="flex gap-2 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setSelectedCategory('全部')}
                  className={`px-3 py-1 rounded-xl text-xs font-bold ${selectedCategory === '全部' ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-600'}`}
                >
                  全部
                </button>
                {categories.map((cat) => (
                  <button
                    type="button"
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1 rounded-xl text-xs font-bold ${selectedCategory === cat ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-600'}`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-h-64 overflow-y-auto p-1">
                {filteredServices.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => setSelectedService(item)}
                    className={`p-3 rounded-2xl border text-xs cursor-pointer transition flex flex-col justify-between ${
                      selectedService?.id === item.id ? 'border-rose-500 bg-rose-50 text-rose-600 font-bold shadow-sm' : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    {item.image_url ? (
                      <img src={item.image_url} alt={item.title} className="w-full h-28 object-cover rounded-xl mb-2" />
                    ) : (
                      <div className="w-full h-28 bg-rose-100/50 rounded-xl mb-2 flex items-center justify-center text-rose-300 text-xs font-bold">💅 精選款式</div>
                    )}
                    <div>
                      <span className="bg-rose-100 text-rose-700 text-[9px] px-1.5 py-0.5 rounded-md font-bold">{item.category}</span>
                      <p className="font-bold text-sm mt-1">{item.title}</p>
                      <div className="flex justify-between items-center mt-2 text-[11px]">
                        <span className="text-slate-400">⏱️ {item.duration} 分鐘</span>
                        <span className="font-mono text-rose-500 font-bold">${item.price}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-4 bg-rose-50/60 rounded-2xl border border-rose-100 space-y-2 text-xs">
              <p className="font-bold text-rose-700">📸 直接上傳手機照片或參考圖：</p>
              <input type="file" accept="image/*" onChange={handleCustomImageUpload} className="text-xs text-slate-500" />
              {uploadingCustomImg && <p className="text-[10px] text-rose-500">照片上傳中...</p>}
              {customImageUrl && <img src={customImageUrl} alt="自帶圖預覽" className="w-20 h-20 object-cover rounded-xl border mt-2" />}
            </div>
          )}

          {/* 加購與服務選項 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* 延甲加購 */}
            <div className="p-3.5 bg-amber-50/60 rounded-2xl border border-amber-200 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-amber-900">✂️ 加購延甲服務</p>
                <p className="text-[10px] text-amber-700">+NT$ 500 ｜ 額外增加 30 分鐘</p>
              </div>
              <input
                type="checkbox"
                checked={needExtension}
                onChange={(e) => setNeedExtension(e.target.checked)}
                className="w-5 h-5 rounded text-rose-500 focus:ring-rose-400"
              />
            </div>

            {/* 卸甲選項 (免費加時 30 分鐘) */}
            <div className="p-3.5 bg-sky-50/60 rounded-2xl border border-sky-200 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-sky-900">💅 需要卸甲服務</p>
                <p className="text-[10px] text-sky-700">+NT$ 0 ｜ 額外增加 30 分鐘</p>
              </div>
              <input
                type="checkbox"
                checked={needRemoval}
                onChange={(e) => setNeedRemoval(e.target.checked)}
                className="w-5 h-5 rounded text-rose-500 focus:ring-rose-400"
              />
            </div>
          </div>

          {/* 一週可預約時段看板 */}
          <div className="space-y-4 pt-2">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-rose-100 pb-3">
              <div>
                <h2 className="text-lg font-bold text-slate-800">📅 步驟 2：直接點選一週可預約時段</h2>
                <div className="text-xs text-rose-600 font-bold mt-1 flex flex-wrap gap-2 items-center">
                  <span>款式：{bookingType === 'catalog' ? selectedService?.title : '自帶圖客製'}</span>
                  <span>｜</span>
                  <span>總時間：{calculateTotalDuration()} 分鐘</span>
                  <span>｜</span>
                  <span className="text-emerald-700 font-extrabold text-sm">預估總價：NT$ {calculateTotalPrice()}</span>
                </div>
              </div>

              <div className="flex gap-2">
                <button type="button" onClick={() => changeWeek(-1)} className="bg-slate-100 text-xs px-3 py-1 rounded-xl font-bold">◀ 上一週</button>
                <button type="button" onClick={() => setCurrentMonday(getMonday(new Date()))} className="bg-rose-50 text-rose-600 text-xs px-3 py-1 rounded-xl font-bold border border-rose-200">本週</button>
                <button type="button" onClick={() => changeWeek(1)} className="bg-slate-100 text-xs px-3 py-1 rounded-xl font-bold">下一週 ▶</button>
              </div>
            </div>

            {loadingWeek ? (
              <p className="text-center py-8 text-xs text-slate-400">正在計算可預約空檔...</p>
            ) : (
              <div className="overflow-x-auto max-h-[360px] overflow-y-auto border border-slate-200 rounded-2xl">
                <table className="w-full text-center text-xs border-collapse">
                  <thead className="sticky top-0 bg-rose-100/90 backdrop-blur-sm z-10">
                    <tr className="border-b text-rose-800 font-bold">
                      <th className="py-2.5 px-2 bg-rose-200/80 w-16">時間</th>
                      {weekDates.map((d) => (
                        <th key={d.dateStr} className="py-2.5 px-2 min-w-[70px]">{d.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {TIME_SLOTS.map((time) => (
                      <tr key={time} className="border-b bg-white hover:bg-slate-50/50">
                        <td className="py-1.5 px-1 font-mono font-bold text-[11px] text-slate-500 bg-slate-100 sticky left-0">{time}</td>
                        {weekDates.map((d) => {
                          const key = `${d.dateStr}_${time}`;
                          const isAvailable = !!weekAvailableMap[key];
                          const isSelected = selectedSlot?.dateStr === d.dateStr && selectedSlot?.timeSlot === time;

                          // 💡 新增：取得該日期已預約的清單，並檢查此時間點與服務時長是否會衝突
// 💡 從 orders 陣列中，過濾出「這一天 (d.dateStr)」的預約，並轉成 { startTime, duration } 的格式
// 💡 從 orders 中的 service_name 拆解出日期與時間 (例如: "[預約] 琉璃海洋 (2026-08-14 14:00)")
const dayBookings = orders
      ? orders
      .filter((order: any) => order.status !== 'cancelled' && order.status !== '已取消')
          .map((order: any) => {
            const match = order.service_name?.match(/\((\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\)/);
            if (match) {
              // 💡 判斷舊訂單有沒有包含卸甲(+30m)或延甲(+30m)
              let bookedDuration = 120; // 基礎時間 2 小時
              if (order.service_name?.includes('卸甲')) bookedDuration += 30;
              if (order.service_name?.includes('延甲')) bookedDuration += 30;

              return {
                date: match[1],
                startTime: match[2],
                duration: bookedDuration, // 使用計算後的真實時長
              };
            }
            return null;
          })
          .filter((item: any) => item && item.date === d.dateStr)
      : [];

    // 💡 只保留這一行，不要重複寫兩次 isConflict
   const isConflict = isSlotDisabled(time, calculateTotalDuration(), dayBookings as any);
    
    // 最終可否點擊：開放且無衝突
    const canBook = isAvailable && !isConflict;
                          
                          return (
                            <td key={d.dateStr} className="p-1">
                              {canBook ? (
  <button
    type="button"
    onClick={() => setSelectedSlot({ dateStr: d.dateStr, timeSlot: time })}
    className={`w-full py-1.5 rounded-lg text-[10px] font-bold transition ${
      isSelected
        ? 'bg-rose-600 text-white shadow-md scale-105'
        : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
    }`}
  >
    {isSelected ? '✓ 已選' : '可預約'}
  </button>
) : (
  // 💡 被占用或時間衝突時顯示「不可選 / -」
  <span className="text-[10px] text-slate-300 font-normal">
    {isConflict ? '時間重疊' : '-'}
  </span>
)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {selectedSlot && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 font-bold flex justify-between items-center">
                <span>🎉 已選擇：{selectedSlot.dateStr} 【{selectedSlot.timeSlot}】</span>
                <button type="button" onClick={() => setSelectedSlot(null)} className="text-emerald-600 text-[11px] underline">取消重選</button>
              </div>
            )}
          </div>

          {/* 手部狀況 */}
          <div className="space-y-2 pt-2 border-t border-rose-100">
            <label className="block text-xs font-bold text-slate-600">3. 其他手部 / 指甲狀況 (可複選)</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-100">
              {HAND_CONDITIONS.map((cond) => {
                const isChecked = selectedConditions.includes(cond);
                return (
                  <label
                    key={cond}
                    onClick={() => handleConditionToggle(cond)}
                    className={`flex items-center gap-2 p-2 rounded-xl cursor-pointer text-xs transition border ${
                      isChecked ? 'bg-rose-50 border-rose-300 text-rose-700 font-bold' : 'bg-white border-slate-200 text-slate-600'
                    }`}
                  >
                    <input type="checkbox" checked={isChecked} onChange={() => {}} className="rounded text-rose-500" />
                    <span>{cond}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* 備註與須知 */}
          <div className="space-y-3">
            <input
              type="text"
              placeholder="其他補充備註 (選填)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full px-4 py-2 rounded-xl border border-slate-200 text-xs outline-none"
            />

            <label className="flex items-start gap-2 cursor-pointer bg-rose-50/50 p-3 rounded-2xl border border-rose-100 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={agreedTerms}
                onChange={(e) => setAgreedTerms(e.target.checked)}
                className="mt-0.5 rounded text-rose-500"
              />
              <span>我已閱讀並同意<strong>店家預約須知</strong>（遲到超過 15 分鐘將自動取消名額、病理性灰指甲恕無法施作）。</span>
            </label>
          </div>

          {/* 📸 提醒顧客截圖並傳送至 IG 的提示區塊 */}
<div className="mt-4 p-4 bg-rose-50 border border-rose-200 rounded-2xl text-center space-y-1">
  <p className="text-rose-700 font-bold text-sm">
    📸 請務必將此頁面「截圖」並私訊傳至我們的 IG 帳號！
  </p>
  <p className="text-slate-600 text-xs">
    傳送截圖後，店家將為您核對並確認預約時段喔 💕
  </p>
</div>

          <button
            type="submit"
            disabled={isSubmitting || !selectedSlot || !agreedTerms}
            className="w-full bg-rose-500 hover:bg-rose-600 text-white font-bold py-3.5 rounded-2xl transition disabled:opacity-50 text-sm shadow-md"
          >
            {isSubmitting ? '預約處理中...' : selectedSlot ? `確認預約 (${selectedSlot.dateStr} ${selectedSlot.timeSlot}) - NT$ ${calculateTotalPrice()}` : '請先點選可預約時段'}
          </button>
        </form>
      </main>

{/* 🛒 預約結帳與付訂金彈窗 */}
      <CheckoutModal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        service={{
          id: selectedService?.id || 'custom',
          name: bookingType === 'catalog' ? (selectedService?.title || '美甲服務') : '📷 自帶圖片/現場討論',
          price: selectedService?.price || 0,
        }}
        bookingDate={selectedSlot?.dateStr || ''}
        bookingTime={selectedSlot?.timeSlot || ''}
        onSuccess={() => {
          window.location.href = '/member';
        }}
      />

    </div>
  );
}