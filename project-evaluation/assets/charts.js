(function () {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();

  // --- Radar Chart: 四维度评分 ---
  var radarEl = document.getElementById('chart-radar');
  if (radarEl) {
    var radar = echarts.init(radarEl, null, { renderer: 'svg' });
    radar.setOption({
      animation: false,
      tooltip: {
        trigger: 'item',
        appendToBody: true,
        formatter: function (params) {
          var indicators = ['创新性', '实用性', '完成度', '美观度/设计体验'];
          var html = '<div style="font-weight:600;margin-bottom:4px;">' + params.name + '</div>';
          params.value.forEach(function (v, i) {
            html += '<div style="font-size:12px;color:' + muted + ';">' + indicators[i] + ': <strong style="color:' + ink + ';">' + v + '</strong> / 100</div>';
          });
          return html;
        }
      },
      radar: {
        indicator: [
          { name: '创新性', max: 100 },
          { name: '实用性', max: 100 },
          { name: '完成度', max: 100 },
          { name: '美观度', max: 100 }
        ],
        center: ['50%', '55%'],
        radius: '68%',
        axisName: {
          color: ink,
          fontSize: 13,
          fontWeight: 600
        },
        splitArea: {
          areaStyle: {
            color: ['rgba(245,240,232,0.3)', 'rgba(255,255,255,0.5)'],
            shadowColor: 'rgba(0,0,0,0.05)',
            shadowBlur: 4
          }
        },
        axisLine: {
          lineStyle: { color: rule }
        },
        splitLine: {
          lineStyle: { color: rule, width: 1 }
        }
      },
      series: [{
        name: '知纲·课件编译器',
        type: 'radar',
        data: [{
          value: [87, 83, 80, 75],
          name: '当前评分',
          symbol: 'circle',
          symbolSize: 8,
          lineStyle: {
            color: accent,
            width: 2
          },
          itemStyle: {
            color: accent
          },
          areaStyle: {
            color: {
              type: 'radial',
              x: 0.5, y: 0.5, r: 0.8,
              colorStops: [
                { offset: 0, color: accent + '40' },
                { offset: 1, color: accent + '15' }
              ]
            }
          },
          label: {
            show: true,
            formatter: function (params) {
              return params.value;
            },
            color: ink,
            fontSize: 13,
            fontWeight: 700,
            fontFamily: 'JetBrains Mono, monospace'
          }
        }]
      }]
    });
    window.addEventListener('resize', function () { radar.resize(); });
  }
})();
