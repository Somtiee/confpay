use anchor_lang::prelude::*;

declare_id!("EpWKv3uvNXVioG5J7WhyDoPy1G6LJ9vTbTcbiKZo6Jjw");

#[program]
pub mod confpay {
    use super::*;

    pub fn initialize_payroll(ctx: Context<InitializePayroll>, company_name: String) -> Result<()> {
        let payroll = &mut ctx.accounts.payroll;
        payroll.admin = ctx.accounts.admin.key();
        payroll.employee_count = 0;
        payroll.company_name = company_name;
        Ok(())
    }

    pub fn add_employee(
        ctx: Context<AddEmployee>,
        name: String,
        role: String,
        ciphertext: Vec<u8>,
        input_type: u8,
        pin: String,
        schedule: String,
        next_payment_ts: i64,
    ) -> Result<()> {
        let payroll = &mut ctx.accounts.payroll;
        let employee = &mut ctx.accounts.employee;

        require!(
            ctx.accounts.admin.key() == payroll.admin,
            CustomError::Unauthorized
        );

        employee.payroll = payroll.key();
        employee.wallet = ctx.accounts.employee_wallet.key();
        employee.name = name;
        employee.role = role;
        employee.ciphertext = ciphertext;
        employee.input_type = input_type;
        employee.pin = pin;
        employee.schedule = schedule;
        employee.next_payment_ts = next_payment_ts;
        employee.last_paid_ts = 0;

        payroll.employee_count += 1;

        Ok(())
    }

    pub fn update_employee(
        ctx: Context<UpdateEmployee>,
        name: String,
        role: String,
        ciphertext: Vec<u8>,
        input_type: u8,
        pin: String,
        schedule: String,
        next_payment_ts: i64,
    ) -> Result<()> {
        let employee = &mut ctx.accounts.employee;
        let payroll = &ctx.accounts.payroll;

        require!(
            ctx.accounts.admin.key() == payroll.admin,
            CustomError::Unauthorized
        );

        employee.name = name;
        employee.role = role;
        employee.ciphertext = ciphertext;
        employee.input_type = input_type;
        employee.pin = pin;
        employee.schedule = schedule.clone();
        employee.next_payment_ts = next_payment_ts;

        Ok(())
    }

    pub fn pay_employee(ctx: Context<PayEmployee>) -> Result<()> {
        let payroll = &ctx.accounts.payroll;
        let employee = &mut ctx.accounts.employee;

        // REMOVED: Admin check to allow Automation Bot to call this
        // require!(
        //    ctx.accounts.admin.key() == payroll.admin,
        //    CustomError::Unauthorized
        // );

        let clock = Clock::get()?;
        employee.last_paid_ts = clock.unix_timestamp;

        // Auto-schedule next payment
        let one_day = 86400;
        let next_ts = match employee.schedule.as_str() {
            "Weekly" => clock.unix_timestamp + (one_day * 7),
            "Bi-Weekly" => clock.unix_timestamp + (one_day * 14),
            "Monthly" => clock.unix_timestamp + (one_day * 30),
            _ => {
                // If Custom, switch to Weekly automatically
                employee.schedule = "Weekly".to_string();
                clock.unix_timestamp + (one_day * 7)
            }, 
        };
        
        employee.next_payment_ts = next_ts;

        emit!(EmployeePaid {
            payroll: payroll.key(),
            employee: employee.key(),
        });

        Ok(())
    }

    pub fn remove_employee(ctx: Context<RemoveEmployee>) -> Result<()> {
        let payroll = &mut ctx.accounts.payroll;
        let employee = &ctx.accounts.employee;

        require!(
            ctx.accounts.admin.key() == payroll.admin,
            CustomError::Unauthorized
        );

        // Manual Close Logic for UncheckedAccount
        if **employee.lamports.borrow() > 0 {
            let dest_starting_lamports = ctx.accounts.admin.lamports();
            let src_lamports = employee.lamports();

            **employee.lamports.borrow_mut() = 0;
            **ctx.accounts.admin.lamports.borrow_mut() = dest_starting_lamports
                .checked_add(src_lamports)
                .unwrap();
        }

        if payroll.employee_count > 0 {
             payroll.employee_count -= 1;
        }

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializePayroll<'info> {
    #[account(
        init,
        seeds = [b"payroll", admin.key().as_ref()], // ✅ PDA FIX
        bump,
        payer = admin,
        space = 8 + Payroll::INIT_SPACE
    )]
    pub payroll: Box<Account<'info, Payroll>>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddEmployee<'info> {
    #[account(mut)]
    pub payroll: Box<Account<'info, Payroll>>,

    #[account(
        init,
        seeds = [b"employee", payroll.key().as_ref(), employee_wallet.key().as_ref()],
        bump,
        payer = admin,
        space = 8 + Employee::INIT_SPACE
    )]
    pub employee: Box<Account<'info, Employee>>,

    /// CHECK: wallet address of the employee
    pub employee_wallet: UncheckedAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PayEmployee<'info> {
    pub payroll: Box<Account<'info, Payroll>>,
    #[account(
        mut,
        realloc = 8 + Employee::INIT_SPACE,
        realloc::payer = admin,
        realloc::zero = false,
    )]
    pub employee: Box<Account<'info, Employee>>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateEmployee<'info> {
    #[account(
        mut,
        seeds = [b"employee", payroll.key().as_ref(), employee_wallet.key().as_ref()],
        bump,
        realloc = 8 + Employee::INIT_SPACE,
        realloc::payer = admin,
        realloc::zero = false,
    )]
    pub employee: Box<Account<'info, Employee>>,

    /// CHECK: wallet address of the employee
    pub employee_wallet: UncheckedAccount<'info>,

    pub payroll: Box<Account<'info, Payroll>>,

    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RemoveEmployee<'info> {
    #[account(mut)]
    pub payroll: Box<Account<'info, Payroll>>,

    #[account(
        mut,
        seeds = [b"employee", payroll.key().as_ref(), employee_wallet.key().as_ref()],
        bump,
    )]
    /// CHECK: Force closing, bypassing deserialization
    pub employee: UncheckedAccount<'info>,

    /// CHECK: wallet address of the employee
    pub employee_wallet: UncheckedAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct Payroll {
    pub admin: Pubkey,
    pub employee_count: u64,
    #[max_len(50)]
    pub company_name: String,
}

#[account]
#[derive(InitSpace)]
pub struct Employee {
    pub payroll: Pubkey,
    pub wallet: Pubkey,

    #[max_len(50)]
    pub name: String,

    #[max_len(32)]
    pub role: String,

    #[max_len(10)]
    pub pin: String,

    #[max_len(20)]
    pub schedule: String,

    #[max_len(256)]
    pub ciphertext: Vec<u8>,

    pub input_type: u8,

    pub next_payment_ts: i64,
    pub last_paid_ts: i64,
}

#[event]
pub struct EmployeePaid {
    pub payroll: Pubkey,
    pub employee: Pubkey,
}

#[error_code]
pub enum CustomError {
    #[msg("Unauthorized action")]
    Unauthorized,
}
