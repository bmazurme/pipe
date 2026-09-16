export function convertToHours(timeString: string) {
    // Регулярные выражения для поиска значений с единицами
    const regexes = {
        months: /(\d+)mo/g,
        weeks: /(\d+)w/g,
        days: /(\d+)d/g,
        hours: /(\d+)h/g,
        // minutes: /(\d+)m/g
    };

    let totalHours = 0;

    // Обрабатываем месяцы (1mo ≈ 120 часов)
    let match;
    while ((match = regexes.months.exec(timeString)) !== null) {
      totalHours += parseInt(match[1], 10) * 120;
    }

    // Обрабатываем недели (1w = 40 рабочих часов)
    while ((match = regexes.weeks.exec(timeString)) !== null) {
      totalHours += parseInt(match[1], 10) * 40;
    }

    // Обрабатываем дни (1d = 8 рабочих часа)
    while ((match = regexes.days.exec(timeString)) !== null) {
      totalHours += parseInt(match[1], 10) * 8;
    }

    // Обрабатываем часы (1h = 1 час)
    while ((match = regexes.hours.exec(timeString)) !== null) {
      totalHours += parseInt(match[1], 10);
    }

    // // Обрабатываем минуты (1m = 1/60 часа)
    // while ((match = regexes.minutes.exec(timeString)) !== null) {
    //   totalHours += parseInt(match[1], 10) / 60;
    // }

    return totalHours; // Можно округлить: Math.round(totalHours) или totalHours.toFixed(2)
}
