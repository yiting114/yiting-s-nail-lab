'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface ServiceItem {
  id: string;
  title: string;
  price: number;
  duration: number;
  category: string;
  image_url?: string;
}

interface OrderItem {
  id: string;
  created_at: string;
  service_name: string;
  amount: number;
  deposit_status: string;
  bank_last_five?: string;
  hand_condition?: string;
  reference_image?: string;
  // 💡 補上實際營運需要的欄位，就不會再報錯：
  status?: string;
  user_id?: string;
  price?: number;
  booking_time?: string;
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

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<'schedule' | 'orders' | 'services'>('schedule');

  // 款式 State
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [newCategory, setNewCategory] = useState('手部造型系列');
  const [newTitle, setNewTitle] = useState('');
  const [newPrice, setNewPrice] = useState<string>('');
  const [newDuration, setNewDuration] = useState<string>('90');
  const [newImageUrl, setNewImageUrl] = useState<string>('');
  const [uploadingImage, setUploadingImage] = useState<boolean>(false);
  const [newRewardPoints, setNewRewardPoints] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
const [editPoints, setEditPoints] = useState<string>('');
const [editPrice, setEditPrice] = useState<string>('');

  // 時段 State (預設全關)
  const [currentMonday, setCurrentMonday] = useState<Date>(getMonday(new Date()));
  const [weekDates, setWeekDates] = useState<{ dateStr: string; label: string }[]>([]);
  const [weekSlots, setWeekSlots] = useState<{ [key: string]: boolean }>({});

  // 訂單 State
  const [orders, setOrders] = useState<OrderItem[]>([]);

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

  const fetchWeekSlots = async () => {
    if (weekDates.length === 0) return;
    const startDate = weekDates[0].dateStr;
    const endDate = weekDates[6].dateStr;

    const { data } = await supabase
      .from('available_slots')
      .select('slot_date, time_slot, is_open')
      .gte('slot_date', startDate)
      .lte('slot_date', endDate);

    const map: { [key: string]: boolean } = {};
    if (data) {
      data.forEach((item) => {
        map[`${item.slot_date}_${item.time_slot}`] = item.is_open;
      });
    }
    setWeekSlots(map);
  };

const fetchOrders = async () => {
  // 1. 抓取所有訂單
  const { data: orderData } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false });

  if (!orderData) return;

  // 2. 抓取所有會員 Profiles
  const { data: profileData } = await supabase
    .from('profiles')
    .select('*');

  // 3. 把顧客資料 (profiles) 比對拼接到訂單物件 (o) 上
  const combinedOrders = orderData.map((order) => {
    const userProfile = profileData?.find((p) => p.id === order.user_id);
    return {
      ...order,
      profiles: userProfile || null,
    };
  });

  setOrders(combinedOrders);
};

  const fetchServices = async () => {
    const { data } = await supabase.from('services').select('*').order('created_at', { ascending: true });
    if (data) setServices(data);
  };

useEffect(() => {
    fetchWeekSlots();
    fetchOrders();
    fetchServices();

    // 💡 只新增這幾行監聽 orders 變動
    const channel = supabase
      .channel('admin-orders-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => fetchOrders()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [weekDates]);

  const changeWeek = (offsetWeeks: number) => {
    const next = new Date(currentMonday);
    next.setDate(next.getDate() + offsetWeeks * 7);
    setCurrentMonday(getMonday(next));
  };

  const toggleSlot = async (dateStr: string, time: string) => {
    const key = `${dateStr}_${time}`;
    const newStatus = !weekSlots[key];

    setWeekSlots((prev) => ({ ...prev, [key]: newStatus }));

    await supabase.from('available_slots').upsert({
      slot_date: dateStr,
      time_slot: time,
      is_open: newStatus,
    }, { onConflict: 'slot_date,time_slot' });
  };

  // 一鍵開啟當天白天熱門時段 (10:00 - 20:00)
  const openBusinessHoursForDay = async (dateStr: string) => {
    const updates = TIME_SLOTS.map((time) => {
      const hour = parseInt(time.split(':')[0], 10);
      return {
        slot_date: dateStr,
        time_slot: time,
        is_open: hour >= 10 && hour < 20,
      };
    });

    const { error } = await supabase.from('available_slots').upsert(updates, { onConflict: 'slot_date,time_slot' });
    if (!error) fetchWeekSlots();
  };

  // 一鍵關閉當天所有時段
  const closeAllHoursForDay = async (dateStr: string) => {
    const updates = TIME_SLOTS.map((time) => ({
      slot_date: dateStr,
      time_slot: time,
      is_open: false,
    }));

    const { error } = await supabase.from('available_slots').upsert(updates, { onConflict: 'slot_date,time_slot' });
    if (!error) fetchWeekSlots();
  };

const updateDepositStatus = async (orderId: string, status: string) => {
  const isCancel = status === '已取消預約' || status === '已取消';
  await supabase
    .from('orders')
    .update({ 
      deposit_status: status,
      ...(isCancel ? { status: 'cancelled' } : {}) 
    })
    .eq('id', orderId);
  fetchOrders();
};

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      if (!e.target.files || e.target.files.length === 0) return;
      const file = e.target.files[0];
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;

      setUploadingImage(true);

      const { error: uploadError } = await supabase.storage
        .from('service-images')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('service-images')
        .getPublicUrl(fileName);

      setNewImageUrl(urlData.publicUrl);
    } catch (error: any) {
      alert('圖片上傳失敗：' + error.message);
    } finally {
      setUploadingImage(false);
    }
  };

  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from('services').insert([
      {
        category: newCategory || '一般款式',
        title: newTitle,
        price: Number(newPrice),
        duration: Number(newDuration),
        image_url: newImageUrl,
        reward_points: Number(newRewardPoints) || 0,
      }
    ]);
    if (!error) {
      setNewTitle('');
      setNewPrice('');
      setNewImageUrl('');
      setNewRewardPoints('');
      fetchServices();
    }
  };

  const handleDeleteService = async (id: string) => {
    await supabase.from('services').delete().eq('id', id);
    fetchServices();
  };

  // 更新舊款式的點數與價格
const handleUpdateService = async (serviceId: string) => {
  const { error } = await supabase
    .from('services')
    .update({
      reward_points: Number(editPoints) || 0,
      price: Number(editPrice) || 0,
    })
    .eq('id', serviceId);

  if (error) {
    alert(`更新失敗: ${error.message}`);
  } else {
    alert('款式資料已成功更新！');
    setEditingId(null);
    fetchServices(); // 重新整理款式列表
  }
};

// 💡 設定換算比例：消費多少元換 1 點（可自由調整，如 100 代表 100元=1點）
const POINT_RATIO = 100;

const handleCompleteOrder = async (order: any) => {
  if (!confirm('確認完成服務並發放點數嗎？')) return;

  // 1. 相容不同的金額欄位名稱 (優先拿 price，若無則拿 total_price 或 amount)
  const orderPrice = Number(order.price || order.total_price || order.amount || 0);

  // 2. 自動依金額計算點數 (無條件捨去)
  const earnedPoints = Math.floor(orderPrice / POINT_RATIO);

  try {
    // 3. 更新訂單狀態為已完成 (注意大小寫改為 'COMPLETED')
    const { error: orderErr } = await supabase
      .from('orders')
      .update({ 
        status: 'COMPLETED', 
        deposit_status: '已完成' 
      })
      .eq('id', order.id);

    if (orderErr) throw orderErr;

    // 4. 累加點數至顧客帳號
    if (order.user_id && earnedPoints > 0) {
      // (A) 先取得顧客當前點數
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('points')
        .eq('id', order.user_id)
        .single();

      if (profileErr) console.error('讀取顧客點數失敗:', profileErr);

      const currentPoints = profile?.points || 0;
      const newPoints = currentPoints + earnedPoints;

      // (B) 💡 補上這段：將更新後的點數寫回 Supabase profiles 資料表
      const { error: updatePointErr } = await supabase
        .from('profiles')
        .update({ points: newPoints })
        .eq('id', order.user_id);

      if (updatePointErr) throw updatePointErr;
    }

    alert(`預約已完成！成功發送 ${earnedPoints} 點給顧客。`);
    
    // 如果頁面有重新拉取列表的函式，請在這裡呼叫（如 fetchOrders()）
    window.location.reload(); 

  } catch (err: any) {
    console.error('完成訂單失敗:', err);
    alert('操作失敗：' + (err.message || '未知錯誤'));
  }
};

const handleSaveAdminNote = async (orderId: string, note: string) => {
  await supabase
    .from('orders')
    .update({ admin_note: note })
    .eq('id', orderId);
};

  return (
    <div className="min-h-screen bg-slate-100 p-6 font-sans text-slate-800">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* 後台頁籤 */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-800">💅 美甲旗艦後台管理</h1>
            <p className="text-xs text-slate-500 mt-0.5">預設時段全關 ｜ 訂單款項管理 ｜ 款式圖庫新增</p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('schedule')}
              className={`px-4 py-2 rounded-xl text-xs font-bold ${activeTab === 'schedule' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              📅 手動開放時段
            </button>
            <button
              onClick={() => setActiveTab('orders')}
              className={`px-4 py-2 rounded-xl text-xs font-bold ${activeTab === 'orders' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              📋 顧客預約訂單 ({orders.length})
            </button>
            <button
              onClick={() => setActiveTab('services')}
              className={`px-4 py-2 rounded-xl text-xs font-bold ${activeTab === 'services' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              🎨 款式管理
            </button>
          </div>
        </div>

        {/* 頁籤 1：排班矩陣 (預設關閉) */}
        {activeTab === 'schedule' && (
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-base font-bold text-slate-800">📅 一週開放時段點選 (紅色為開放，灰色為關閉)</h2>
              <div className="flex gap-2">
                <button onClick={() => changeWeek(-1)} className="bg-slate-100 text-xs px-3 py-1.5 rounded-xl font-bold">◀ 上一週</button>
                <button onClick={() => setCurrentMonday(getMonday(new Date()))} className="bg-rose-50 text-rose-600 text-xs px-3 py-1.5 rounded-xl font-bold border border-rose-200">本週</button>
                <button onClick={() => changeWeek(1)} className="bg-slate-100 text-xs px-3 py-1.5 rounded-xl font-bold">下一週 ▶</button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[480px] overflow-y-auto border border-slate-200 rounded-2xl">
              <table className="w-full text-center text-xs border-collapse">
                <thead className="sticky top-0 bg-slate-100 z-10">
                  <tr className="border-b text-slate-600 font-bold">
                    <th className="py-2.5 px-3 bg-slate-200 w-20">時間</th>
                    {weekDates.map((d) => (
                      <th key={d.dateStr} className="py-2.5 px-2">
                        <div>{d.label}</div>
                        <div className="flex justify-center gap-1 mt-1 text-[9px]">
                          <button onClick={() => openBusinessHoursForDay(d.dateStr)} className="text-emerald-600 hover:underline">開白天</button>
                          <span>｜</span>
                          <button onClick={() => closeAllHoursForDay(d.dateStr)} className="text-slate-400 hover:underline">全關</button>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TIME_SLOTS.map((time) => (
                    <tr key={time} className="border-b bg-white">
                      <td className="py-1.5 px-2 font-mono font-bold text-[11px] text-slate-500 bg-slate-100">{time}</td>
                      {weekDates.map((d) => {
                        const key = `${d.dateStr}_${time}`;
                        const isOpen = !!weekSlots[key];
                        return (
                          <td key={d.dateStr} className="p-1">
                            <button
                              onClick={() => toggleSlot(d.dateStr, time)}
                              className={`w-full py-1.5 rounded-lg text-[10px] font-bold transition ${
                                isOpen ? 'bg-emerald-500 text-white shadow-sm' : 'bg-slate-100 text-slate-300'
                              }`}
                            >
                              {isOpen ? '開放中' : '—'}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 頁籤 2：顧客訂單與匯款核對 */}
        {activeTab === 'orders' && (
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 space-y-4">
            <h2 className="text-base font-bold text-slate-800">📋 顧客預約訂單總覽</h2>
            
            {orders.length === 0 ? (
              <p className="text-xs text-slate-400">目前尚無預約紀錄。</p>
            ) : (
              <div className="space-y-3">
                {orders.map((o) => (
                  <div key={o.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div className="space-y-1">
                      {/* 🆕 插入顧客資料 */}
        {/* 🆕 插入顧客資料（用 as any 繞過型別檢查） */}
<div className="text-xs font-bold text-slate-700 bg-white p-2 rounded-lg border border-slate-200/60 mb-2 flex flex-wrap items-center justify-between gap-2">
  <span>👤 顧客：{(o as any).profiles?.full_name || (o as any).profiles?.name || '未填寫姓名'}</span>
  {(o as any).profiles?.phone && <span className="font-mono text-slate-500">📞 {(o as any).profiles.phone}</span>}
</div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800 text-sm">{o.service_name}</span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          o.deposit_status === '已確認訂金' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
  (o as any).status === 'cancelled' || (o as any).status === '已取消'
    ? 'bg-slate-200 text-slate-600'
    : o.deposit_status === '已確認訂金'
    ? 'bg-emerald-100 text-emerald-700'
    : 'bg-amber-100 text-amber-700'
}`}>
  {(o as any).status === 'cancelled' || (o as any).status === '已取消'
    ? '已取消'
    : o.deposit_status || '待處理'}
</span>      {o.deposit_status || '待處理'}
                        </span>
                      </div>
                      <p className="text-slate-500">預估金額：<strong className="text-rose-500">NT$ {o.amount}</strong> ｜ 備註/狀況：{o.hand_condition}</p>
                      {o.bank_last_five && <p className="text-emerald-600 font-bold">💳 顧客回報帳號後五碼：{o.bank_last_five}</p>}
                    </div>

<div className="flex gap-2 flex-wrap">
              <button
                onClick={() => updateDepositStatus(o.id, '已確認訂金')}
                className="bg-emerald-500 text-white px-3 py-1.5 rounded-xl font-bold text-xs"
              >
                ✓ 確認收到訂金
              </button>

              {/* 🎉 新增：完成服務按鈕 */}
              <button
  disabled={o.status === 'COMPLETED'}
  onClick={() => handleCompleteOrder(o)}
  className={`px-3 py-1.5 rounded-xl font-bold text-xs text-white transition-all ${
    o.status === 'COMPLETED' 
      ? 'bg-gray-400 cursor-not-allowed' 
      : 'bg-indigo-600 hover:bg-indigo-700 active:scale-95'
  }`}
>
  {o.status === 'COMPLETED' ? '已完成服務' : '🎉 完成服務 '}
</button>
              <button
                onClick={() => updateDepositStatus(o.id, '已取消預約')}
                className="bg-slate-200 text-slate-600 px-3 py-1.5 rounded-xl font-bold text-xs"
              >
                取消預約
              </button>
            </div>

            {/* 🔒 新增：店家私下備註框 */}
            <div className="mt-3 pt-2 border-t border-slate-100">
              <label className="text-[10px] font-bold text-slate-400 block mb-1">
                🔒 店家內部私下備註（顧客看不見）：
              </label>
              <input
                type="text"
                defaultValue={(o as any).admin_note || ''}
                placeholder="例：指甲偏薄、偏好裸色系..."
                onBlur={(e) => handleSaveAdminNote(o.id, e.target.value)}
                className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
              />
            </div>                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 頁籤 3：款式管理與圖片上傳 */}
        {activeTab === 'services' && (
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 space-y-4">
            <h2 className="text-base font-bold text-slate-800">➕ 新增與管理美甲款式</h2>
            
            <form onSubmit={handleAddService} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input type="text" placeholder="系列分類 (如: 法式貓眼)" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="px-3 py-2 border rounded-xl text-xs" required />
              <input type="text" placeholder="款式名稱" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="px-3 py-2 border rounded-xl text-xs" required />
              <input type="number" placeholder="價格 ($)" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} className="px-3 py-2 border rounded-xl text-xs" required />
              <input type="number" placeholder="預估施作時間 (分鐘)" value={newDuration} onChange={(e) => setNewDuration(e.target.value)} step="30" className="px-3 py-2 border rounded-xl text-xs" required />
              <input 
  type="number" 
  placeholder="可獲得點數 (如: 1200)" 
  value={newRewardPoints} 
  onChange={(e) => setNewRewardPoints(e.target.value)} 
/>

              <div className="sm:col-span-2 flex gap-2 items-center">
                <input type="file" accept="image/*" onChange={handleImageUpload} className="text-xs text-slate-500" />
                {uploadingImage && <span className="text-[10px] text-rose-500">上傳中...</span>}
              </div>

              <button type="submit" className="sm:col-span-3 bg-rose-500 text-white py-2.5 rounded-xl text-xs font-bold">
                + 建立款式項目
              </button>
            </form>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4">
              {services.map((s) => (
                <div key={s.id} className="p-3 bg-slate-50 rounded-2xl border border-slate-100 text-xs space-y-2">
  <div>
    <p className="font-bold">{s.title}</p>
    <p className="text-slate-400">
      ${s.price} ｜ {s.duration}分鐘 ｜ <span className="text-amber-600 font-bold">✨{(s as any).reward_points || 0}點</span>
    </p>
  </div>

  {/* 如果正在編輯這個款式 */}
  {editingId === s.id ? (
    <div className="space-y-2 pt-2 border-t border-slate-200">
      <div className="flex gap-2">
        <input
          type="number"
          placeholder="價格"
          value={editPrice}
          onChange={(e) => setEditPrice(e.target.value)}
          className="w-1/2 p-1.5 border border-slate-200 rounded-lg text-xs"
        />
        <input
          type="number"
          placeholder="點數"
          value={editPoints}
          onChange={(e) => setEditPoints(e.target.value)}
          className="w-1/2 p-1.5 border border-slate-200 rounded-lg text-xs"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handleUpdateService(s.id)}
          className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg font-bold text-xs"
        >
          儲存
        </button>
        <button
          type="button"
          onClick={() => setEditingId(null)}
          className="px-2.5 py-1 bg-slate-200 text-slate-600 rounded-lg text-xs"
        >
          取消
        </button>
      </div>
    </div>
  ) : (
    /* 一般狀態顯示按鈕 */
    <div className="flex items-center gap-3 pt-1">
      <button
        type="button"
        onClick={() => {
          setEditingId(s.id);
          setEditPrice(String(s.price || ''));
          setEditPoints(String((s as any).reward_points || ''));
        }}
        className="text-slate-600 font-bold hover:underline"
      >
        ✏️ 編輯
      </button>
      <button
        type="button"
        onClick={() => handleDeleteService(s.id)}
        className="text-red-400 font-bold"
      >
        刪除
      </button>
    </div>
  )}
</div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}