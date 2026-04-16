const { createApp, ref, computed, onMounted, nextTick } = Vue;

createApp({
    setup() {
        // ========== 状态变量 ==========
        const step = ref('start'); 
        const questions = ref([]); 
        const charactersData = ref({}); 
        const currentIndex = ref(0); 
        const answers = ref([]); 
        
        const finalResultCode = ref(''); 
        const matchedCharacter = ref({}); 
        const isNeutral = ref(false); 
        
        const isSubmitting = ref(false); 
        const isSubmitted = ref(false); 
        const submitMessage = ref(''); 

        const options = [
            { label: "非常符合", value: 2 },
            { label: "比较符合", value: 1 },
            { label: "中立", value: 0 },
            { label: "不太符合", value: -1 },
            { label: "非常不符合", value: -2 }
        ];

        // ========== 初始化：异步加载 JSON 数据 ==========
        onMounted(async () => {
            try {
                const qRes = await fetch('./data/questions.json');
                const qData = await qRes.json();
                questions.value = seededShuffle(qData);
                
                const cRes = await fetch('./data/characters.json');
                charactersData.value = await cRes.json();
            } catch (error) {
                console.error("数据加载失败！", error);
            }
        });

        const currentQuestion = computed(() => questions.value[currentIndex.value]);
        
        // 修改了按钮的文案逻辑，适应“自动上传”的语境
        const submitBtnText = computed(() => {
            if (isSubmitting.value) return '正在自动生成并同步档案...';
            if (isSubmitted.value) return '档案已永久记录于幻想乡！';
            return '档案同步失败，点击重试';
        });

        const startTest = () => { 
            step.value = 'testing'; 
        };

        const selectOption = (value) => {
            answers.value[currentIndex.value] = {
                id: currentQuestion.value.id,
                dim: currentQuestion.value.dim,
                pole: currentQuestion.value.pole,
                score: value
            };
            
            if (currentIndex.value < questions.value.length - 1) {
                currentIndex.value++;
            } else {
                calculateResult();
            }
        };

        const prevQuestion = () => { 
            if (currentIndex.value > 0) currentIndex.value--; 
        };

        // ========== 核心算分与匹配逻辑 ==========
        const calculateResult = () => {
            let dimScores = { BD: 0, AC: 0, UI: 0, HE: 0, RT: 0, WP: 0 };
            
            answers.value.forEach(ans => {
                if (ans.dim !== 'OTHER') {
                    dimScores[ans.dim] += ans.score * ans.pole;
                }
            });

            let resultCode = "";
            let zeroCount = 0;

            if (dimScores.BD > 0) resultCode += "B"; else if (dimScores.BD < 0) resultCode += "D"; else { resultCode += "D"; zeroCount++; }
            if (dimScores.AC > 0) resultCode += "A"; else if (dimScores.AC < 0) resultCode += "C"; else { resultCode += "C"; zeroCount++; }
            if (dimScores.UI > 0) resultCode += "U"; else if (dimScores.UI < 0) resultCode += "I"; else { resultCode += "I"; zeroCount++; }
            if (dimScores.HE > 0) resultCode += "H"; else if (dimScores.HE < 0) resultCode += "E"; else { resultCode += "E"; zeroCount++; }
            if (dimScores.RT > 0) resultCode += "R"; else if (dimScores.RT < 0) resultCode += "T"; else { resultCode += "T"; zeroCount++; }
            if (dimScores.WP > 0) resultCode += "W"; else if (dimScores.WP < 0) resultCode += "P"; else { resultCode += "P"; zeroCount++; }

            finalResultCode.value = resultCode;
            isNeutral.value = zeroCount >= 4;

            if (isNeutral.value) {
                matchedCharacter.value = charactersData.value["NEUTRAL"];
            } else {
                matchedCharacter.value = charactersData.value[resultCode] || charactersData.value["DEFAULT"];
            }

            step.value = 'result';
            nextTick(() => { 
                drawRadarChart(dimScores); 
            });

            // 【新增】：计算完结果后，自动触发上传函数！
            submitData();
        };

        const seededShuffle = (array, seed = 114514) => {
            let m = array.length, t, i;
            while (m) {
                seed = (seed * 9301 + 49297) % 233280;
                i = Math.floor((seed / 233280) * m--);
                t = array[m];
                array[m] = array[i];
                array[i] = t;
            }
            return array;
        };

        const drawRadarChart = (scores) => {
            const canvas = document.getElementById('radarChart');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            
            const mapScore = (val) => Math.max(0, Math.min(100, ((val + 20) / 40) * 100));

            new Chart(ctx, {
                type: 'radar',
                data: {
                    labels: ['商业现实(B)', '集权效率(A)', '联合开放(U)', '硬核企划(H)', '反叛革新(R)', '事业爆肝(W)'],
                    datasets: [{
                        label: '能力倾向',
                        data: [
                            mapScore(scores.BD), mapScore(scores.AC), mapScore(scores.UI), 
                            mapScore(scores.HE), mapScore(scores.RT), mapScore(scores.WP)
                        ],
                        backgroundColor: 'rgba(220, 38, 38, 0.2)',
                        borderColor: 'rgba(220, 38, 38, 1)',
                        pointBackgroundColor: 'rgba(220, 38, 38, 1)',
                        pointBorderColor: '#fff',
                        pointHoverBackgroundColor: '#fff',
                        pointHoverBorderColor: 'rgba(220, 38, 38, 1)'
                    }]
                },
                options: {
                    scales: {
                        r: {
                            angleLines: { color: 'rgba(0, 0, 0, 0.1)' },
                            grid: { color: 'rgba(0, 0, 0, 0.1)' },
                            pointLabels: { font: { size: 12, family: 'sans-serif', weight: 'bold' }, color: '#374151' },
                            ticks: { display: false, min: 0, max: 100 }
                        }
                    },
                    plugins: { legend: { display: false } }
                }
            });
        };

        // ========== 数据提交到阿里云后台 ==========
        const submitData = async () => {
            // 如果已经提交成功了，就不再重复提交
            if (isSubmitted.value) return;

            isSubmitting.value = true;
            submitMessage.value = "";
            
            // 【重点更新】：加上了 answers 字段，将完整的答题明细转为字符串保存
            const payload = {
                result: finalResultCode.value,
                character: matchedCharacter.value.name || "未知角色",
                isNeutral: isNeutral.value ? 'true' : 'false',
                submitTime: new Date().toISOString(),
                answers: JSON.stringify(answers.value) 
            };

            // 【注意】：请务必将下面替换为你自己的阿里云函数地址！！
            const WEBHOOK_URL = "https://savesurvey-wdzwrthfoe.cn-hangzhou.fcapp.run";

            try {
                const response = await fetch(WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                
                if (response.ok) {
                    submitMessage.value = "";
                    isSubmitted.value = true;
                } else {
                    submitMessage.value = "上传遇到阻碍，由于网络原因未能存档。";
                    isSubmitting.value = false;
                }
            } catch (error) {
                console.error(error);
                submitMessage.value = "网络错误，由于结界原因未能存档。";
                isSubmitting.value = false;
            }
        };

        return { 
            step, questions, currentIndex, currentQuestion, options, 
            finalResultCode, isNeutral, matchedCharacter, 
            startTest, selectOption, prevQuestion, 
            submitData, isSubmitting, isSubmitted, submitMessage, submitBtnText 
        };
    }
}).mount('#app');