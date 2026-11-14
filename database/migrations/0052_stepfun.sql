-- Keep the deployment's existing model-call limits when moving to StepFun.
INSERT INTO budgets (service, per_minute, per_hour, per_day, note)
SELECT 'stepfun',
       COALESCE((SELECT per_minute FROM budgets WHERE service = 'llm'), 100),
       COALESCE((SELECT per_hour FROM budgets WHERE service = 'llm'), 2000),
       COALESCE((SELECT per_day FROM budgets WHERE service = 'llm'), 20000),
       '模型调用熔断（阶跃星辰，所有型号共用）'
ON CONFLICT (service) DO NOTHING;
