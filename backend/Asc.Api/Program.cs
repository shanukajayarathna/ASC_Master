using Asc.Api.Data;
using Asc.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers()
    .AddJsonOptions(opts =>
    {
        opts.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    });

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new Microsoft.OpenApi.Models.OpenApiInfo { Title = "ASC Tea Auction API", Version = "v1" });
});

builder.Services.AddMemoryCache();
builder.Services.AddSingleton<MongoContext>();
builder.Services.AddSingleton<CatalogueImportService>();
// Catalogue data is served straight from the weekly-sale Excel files (data/sales) via
// this seam — swap the implementation to move catalogues into a database (e.g. Azure).
builder.Services.AddSingleton<SaleFileStore>();
builder.Services.AddSingleton<ICatalogueSource>(sp => sp.GetRequiredService<SaleFileStore>());
// Warm every sale's row count/headers at startup so no sale lists as "0 lots" just
// because it hasn't been opened since the meta cache was last written.
builder.Services.AddHostedService<SaleMetaWarmer>();

const string CorsPolicy = "FrontendDev";
builder.Services.AddCors(opts =>
{
    opts.AddPolicy(CorsPolicy, policy =>
    {
        policy.WithOrigins("http://localhost:3000")
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors(CorsPolicy);
app.UseAuthorization();
app.MapControllers();

app.Run();
