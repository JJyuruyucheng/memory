const weatherWords = /天气预报|天气|气温|温度|会不会下雨|会下雨|下雨吗|降雨概率|weather|forecast/iu;

export function weatherQuestion(question) {
  if (!weatherWords.test(question) || /是什么|什么是|原理|定义|体温|水温/u.test(question)) return null;
  const day = /后天|day after tomorrow/iu.test(question) ? 2 : /明天|tomorrow/iu.test(question) ? 1 : 0;
  const city = question.normalize('NFKC')
    .replace(/请问|帮我|查询|查一下|看一下|告诉我|怎么样|如何|多少度|多少|什么样|会不会下雨|会下雨|下雨吗|降雨概率|天气预报|天气|气温|温度|今天|今日|现在|当前|明天|后天|day after tomorrow|today|tomorrow|weather|forecast|how is|in |what is|please/giu, '')
    .replace(/^[\s,，]+|[\s?？。.!！吗呢]+$/gu, '').replace(/的$/u, '').trim();
  if (!city || !/^[\p{Script=Han}\p{Script=Latin}][\p{Script=Han}\p{Script=Latin} .·'-]{1,27}$/u.test(city)) {
    return /天气|weather|forecast/iu.test(question) && /今天|今日|明天|后天|现在|怎么样|today|tomorrow|forecast/iu.test(question) ? { city: '', day } : null;
  }
  return { city, day };
}

function description(code) {
  if (code === 0) return '晴';
  if ([1, 2].includes(code)) return '多云';
  if (code === 3) return '阴';
  if ([45, 48].includes(code)) return '有雾';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '降雪';
  if ([95, 96, 99].includes(code)) return '雷阵雨';
  return Number.isFinite(code) ? '有降雨' : '';
}

export async function weatherReply({ city, day }, requestSignal, fetchWeather = fetch) {
  if (!city) return { reply: '想查哪个城市的天气？', sources: [] };
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(15000)]);
  const get = async (endpoint, values) => {
    const url = new URL(endpoint);
    url.search = new URLSearchParams(values).toString();
    const response = await fetchWeather(url, { signal, redirect: 'manual', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Weather source unavailable');
    return response.json();
  };
  try {
    const geocode = await get('https://geocoding-api.open-meteo.com/v1/search', { name: city, count: '5', language: 'zh', format: 'json' });
    const location = geocode.results?.find(place => Number.isFinite(place.latitude) && Number.isFinite(place.longitude));
    if (!location) return { reply: `天气服务没有找到「${city}」。可以加上省份，或换一种城市名称。`, sources: [] };
    const forecast = await get('https://api.open-meteo.com/v1/forecast', {
      latitude: location.latitude.toFixed(2), longitude: location.longitude.toFixed(2), timezone: location.timezone || 'auto', forecast_days: '3',
      current: 'temperature_2m,apparent_temperature,weather_code',
      daily: 'temperature_2m_min,temperature_2m_max,weather_code,precipitation_probability_max',
    });
    const data = forecast.daily;
    if (![data?.temperature_2m_min?.[day], data?.temperature_2m_max?.[day]].every(Number.isFinite)) throw new Error('Weather data missing');
    const place = [location.admin1, location.name].filter(Boolean).filter((part, index, parts) => parts.indexOf(part) === index).join('·');
    const condition = description(data.weather_code?.[day]);
    const rain = data.precipitation_probability_max?.[day];
    const current = forecast.current;
    const lines = [`${place}${['今天', '明天', '后天'][day]}${condition ? ` ${condition}` : ''}，${data.temperature_2m_min[day]}–${data.temperature_2m_max[day]}℃。`];
    if (day === 0 && Number.isFinite(current?.temperature_2m)) lines.push(`当前 ${current.temperature_2m}℃${Number.isFinite(current.apparent_temperature) ? `，体感 ${current.apparent_temperature}℃` : ''}。`);
    if (Number.isFinite(rain)) lines.push(`最高降水概率 ${rain}%。`);
    return { reply: lines.join('\n'), sources: [{ title: 'Open-Meteo 天气数据', href: 'https://open-meteo.com/' }, { title: 'CC BY 4.0', href: 'https://creativecommons.org/licenses/by/4.0/' }] };
  } catch {
    return { reply: '天气数据暂时取不到，过一会儿再试试。', sources: [] };
  }
}
